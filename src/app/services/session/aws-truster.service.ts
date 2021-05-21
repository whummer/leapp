import { Injectable } from '@angular/core';
import {SessionService} from '../session.service';
import {CredentialsInfo} from '../../models/credentials-info';
import {WorkspaceService} from '../workspace.service';
import {FileService} from '../file.service';
import {AppService} from '../app.service';
import {LeappNotFoundError} from '../../errors/leapp-not-found-error';
import {SessionProviderService} from '../session-provider.service';
import {Session} from '../../models/session';
import {AwsTrusterAccount} from '../../models/aws-truster-account';
import {LeappAwsStsError} from '../../errors/leapp-aws-sts-error';
import AWS from 'aws-sdk';

export interface AwsTrusterAccountRequest {
  accountName: string;
  region: string;
  roleArn: string;
  parentSessionId: string;
}

@Injectable({
  providedIn: 'root'
})
export class AwsTrusterService extends SessionService {

  constructor(
    protected workspaceService: WorkspaceService,
    private appService: AppService,
    private fileService: FileService,
    private sessionProviderService: SessionProviderService
  ) {
    super(workspaceService);
  }

  static sessionTokenFromassumeRoleResponse(assumeRoleResponse: AssumeRoleResponse): { sessionToken: any } {
    return {
      sessionToken: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_access_key_id: assumeRoleResponse.Credentials.AccessKeyId.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_secret_access_key: assumeRoleResponse.Credentials.SecretAccessKey.trim(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_session_token: assumeRoleResponse.Credentials.SessionToken.trim(),
      }
    };
  }

  create(accountRequest: AwsTrusterAccountRequest, profileId: string): void {
    const session = new Session(new AwsTrusterAccount(accountRequest.accountName, accountRequest.region, accountRequest.roleArn, profileId), accountRequest.parentSessionId);
    this.workspaceService.addSession(session);
  }

  async applyCredentials(sessionId: string, credentialsInfo: CredentialsInfo): Promise<void> {
    const session = this.get(sessionId);
    const profileName = this.workspaceService.getProfileName((session.account as AwsTrusterAccount).profileId);
    const credentialObject = {};
    credentialObject[profileName] = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_access_key_id: credentialsInfo.sessionToken.aws_access_key_id,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_secret_access_key: credentialsInfo.sessionToken.aws_secret_access_key,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      aws_session_token: credentialsInfo.sessionToken.aws_session_token,
      region: session.account.region
    };
    return await this.fileService.iniWriteSync(this.appService.awsCredentialPath(), credentialObject);
  }

  async deApplyCredentials(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    const profileName = this.workspaceService.getProfileName((session.account as AwsTrusterAccount).profileId);
    const credentialsFile = await this.fileService.iniParseSync(this.appService.awsCredentialPath());
    delete credentialsFile[profileName];
    return await this.fileService.replaceWriteSync(this.appService.awsCredentialPath(), credentialsFile);
  }

  async generateCredentials(sessionId: string): Promise<CredentialsInfo> {
    // Retrieve Session
    const session = this.get(sessionId);

    // Retrieve Parent Session
    let parentSession: Session;
    try {
      parentSession = this.get(session.parentSessionId);
    } catch (err) {
      throw new LeappNotFoundError(this, `Parent Account Session  not found for Truster Account ${session.account.accountName}`);
    }

    // Generate a credential set from Parent Session
    const parentSessionService = this.sessionProviderService.getService(parentSession.account.type);
    const parentCredentialsInfo = await parentSessionService.generateCredentials(parentSession.sessionId);

    // Make second jump: configure AWS SDK with parent credentials set
    AWS.config.update({
      sessionToken: parentCredentialsInfo.sessionToken.aws_session_token,
      accessKeyId: parentCredentialsInfo.sessionToken.aws_access_key_id,
      secretAccessKey: parentCredentialsInfo.sessionToken.aws_secret_access_key,
    });

    // Assume Role from parent
    // Prepare session credentials set parameters and client
    const sts = new AWS.STS(this.appService.stsOptions(session));
    // Configure Truster Account session parameters
    const params = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      RoleSessionName: `assumed-from-${parentSession.account.accountName}-for-${session.account.accountName}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      RoleArn: (session.account as AwsTrusterAccount).roleArn,
    };

    // Generate Session token
    return this.generateSessionToken(sts, params);
  }

  private async generateSessionToken(sts, params): Promise<CredentialsInfo> {
    try {
      // Assume Role
      const assumeRoleResponse: AssumeRoleResponse = await sts.assumeRole(params).promise();
      // Generate correct object from session token response and return
      return AwsTrusterService.sessionTokenFromassumeRoleResponse(assumeRoleResponse);
    } catch (err) {
      throw new LeappAwsStsError(this, err.message);
    }
  }
}
