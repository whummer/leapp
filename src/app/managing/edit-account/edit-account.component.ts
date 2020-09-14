import {Component, ElementRef, Input, OnInit, ViewChild} from '@angular/core';
import {FormControl, FormGroup, Validators} from '@angular/forms';
import {ActivatedRoute, Router} from '@angular/router';
import {AppService, ToastLevel} from '../../services-system/app.service';
import {ConfigurationService} from '../../services-system/configuration.service';
import {AntiMemLeak} from '../../core/anti-mem-leak';
import {FederatedAccountService} from '../../services/federated-account.service';
import {AwsAccount} from '../../models/aws-account';
import {Workspace} from '../../models/workspace';
import {SessionService} from '../../services/session.service';
import {WorkspaceService} from '../../services/workspace.service';
import {TrusterAccountService} from '../../services/truster-account.service';
import {AzureAccountService} from '../../services/azure-account.service';
import {AzureAccount} from '../../models/azure-account';
import {AccountType} from '../../models/AccountType';
import {ProviderManagerService} from '../../services/provider-manager.service';

@Component({
  selector: 'app-edit-federated-account',
  templateUrl: './edit-account.component.html',
  styleUrls: ['./edit-account.component.scss']
})
export class EditAccountComponent extends AntiMemLeak implements OnInit {

  public form = new FormGroup({
    idpArn: new FormControl('', [Validators.required]),
    accountNumber: new FormControl('', [Validators.required, Validators.maxLength(12), Validators.minLength(12)]),
    subscriptionId: new FormControl('', [Validators.required]),
    name: new FormControl('', [Validators.required]),
    role: new FormControl('', [Validators.required]),
    federatedOrTruster: new FormControl('', [Validators.required]),
    federatedRole: new FormControl('', [Validators.required]),
    federatedAccount: new FormControl('', [Validators.required]),
    federationUrl: new FormControl('', [Validators.required, Validators.pattern('https?://.+')]),
  });

  @Input() selectedAccount;
  @Input() selectedAccountNumber = '';
  @Input() selectedRole = '';
  @Input() fedUrl = '';

  federatedRoles: { name: string, roleArn: string }[] = [];
  federatedAccounts: AwsAccount[] = [];

  workspace: Workspace;
  accounts: AwsAccount[];
  accountId;
  accountIdLocked;

  // Holds an account for filling the form
  account;
  accountType = AccountType.AWS;
  eAccountType = AccountType;
  roles = [];

  selectedType = 'federated';
  toggleOpen = true;
  checkDisabled = false;
  firstTime = false;
  ssoInserted = false;
  providerSelected = false;

  @ViewChild('roleInput', { static: false }) roleInput: ElementRef;

  /**
   * Edit a federated account changing  its parameters
   */
  constructor(
    private configurationService: ConfigurationService,
    private appService: AppService,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private sessionService: SessionService,
    private workspaceService: WorkspaceService,
    private trusterAccountService: TrusterAccountService,
    private fedAccountService: FederatedAccountService,
    private azureAccountService: AzureAccountService,
    private providerManagerService: ProviderManagerService
  ) {
    super();
  }

  ngOnInit() {
    const sub = this.activatedRoute.queryParams.subscribe(params => {
      // Need also a Role Name for Fed e Trust account, for Azure only subscription Id is required
      const accountId = params['accountId'];
      const roleName = params['roleName'];

      this.accounts = this.configurationService.getDefaultWorkspaceSync().accountRoleMapping.accounts;
      this.account = this.accounts.filter(el =>
        (el.accountId.toString() === accountId.toString() && el.awsRoles && el.awsRoles[0].name === roleName) ||
        (el.awsRoles === undefined && el.accountId.toString() === accountId.toString())
      )[0];

      this.accountIdLocked = this.account.accountId;

      this.accountType = this.account.type === 'AWS' ? AccountType.AWS : AccountType.AZURE;
      this.selectedType = !this.account.parent ? 'federated' : 'truster';
      this.providerSelected = true;
      this.ssoInserted = true;

      if (this.accountType === AccountType.AWS && this.account.parent) {
        this.federatedAccounts = this.accounts.filter(el => el.type === 'AWS' && el.parent === undefined);
        this.selectedAccount = this.account.parent;
        this.getFedRoles();
        this.selectedRole = this.account.parentRole;
      }

      if (this.account.awsRoles) {
        this.roles = this.account.awsRoles.map(role => role.name);
      }

      this.appService.validateAllFormFields(this.form);
      this.formValid();
    });

    this.subs.add(sub);
  }

  getFedRoles() {
    // Get the appropriate roles
    const account = this.accounts.filter(acc => (acc.accountId === this.selectedAccount))[0];

    if (account !== undefined && account !== null) {

      this.federatedRoles = account.awsRoles;

      // Set the federated role automatically
      this.selectedAccountNumber = account.accountNumber;
      this.selectedRole = this.federatedRoles[0].name;
    }
  }

  /**
   * Save the first account in the workspace
   */
  saveAccount() {
    if (this.accountType === AccountType.AWS) {
      if (this.selectedType === 'federated') {
        this.saveAwsFederatedAccount();
      } else {
        this.saveAwsTrusterAccount();
      }
    } else {
      this.saveAzureAccount();
    }
  }

  saveAzureAccount() {
    if (this.formValid()) {
      try {
        // Try to create the truster account
        const acc = {
          accountId: this.accountIdLocked,
          accountName: this.form.value.name,
          subscriptionId: this.form.value.subscriptionId,
          type: 'AZURE'
        };
        const updated = this.azureAccountService.updateAzureAccount(acc as AzureAccount);

        if (updated) {
          // Then go to next page
          this.router.navigate(['/sessions', 'session-selected'], {queryParams: {accountId: this.accountId}});
        } else {
          this.appService.toast('Subscription Id must be unique', ToastLevel.WARN, 'Edit Account');
        }
      } catch (err) {
        this.appService.toast(err, ToastLevel.ERROR);
      }
    } else {
      this.appService.toast('Missing required parameters for account', ToastLevel.WARN, 'Add required elements to Account');
    }
  }

  /**
   * This will be removed after created the correct file also in normal mode
   */
  saveAwsTrusterAccount() {
    if (this.formValid()) {
      try {
        const acc = {
          accountId: this.accountIdLocked,
          accountName: this.form.value.name,
          accountNumber: this.form.value.accountNumber,
          idpUrl: this.form.value.federationUrl,
          type: 'AWS',
          idpArn: undefined,
          region: undefined,
          parent: this.selectedAccount,
          parentRole: this.selectedRole,
          awsRoles: this.generateRolesFromNames(this.form.value.accountNumber)
        };

        const updated = this.trusterAccountService.updateTrusterAccount(acc as AwsAccount);

        if (updated) {
          // Then go to next page
          this.router.navigate(['/sessions', 'session-selected']);
        } else {
          this.appService.toast('Account number must be unique', ToastLevel.WARN, 'Edit Account');
        }
      } catch (err) {
        this.appService.toast(err, ToastLevel.ERROR);
      }
    } else {
      this.appService.toast('Add at least one role to the account', ToastLevel.WARN, 'Add Role to Account');
    }
  }

  saveAwsFederatedAccount() {
    if (this.formValid()) {
      try {
        // Add a federation Account to the workspace
        const acc = {
          accountId: this.accountIdLocked,
          accountNumber: this.form.value.accountNumber,
          accountName: this.form.value.name,
          awsRoles: this.generateRolesFromNames(this.form.value.accountNumber),
          idpArn: this.form.value.idpArn,
          idpUrl: this.form.value.federationUrl,
          region: undefined,
          parent: undefined,
          parentRole: this.selectedRole,
          type: 'AWS'
        };
        const updated = this.fedAccountService.updateFederatedAccount(acc as AwsAccount);

        if (updated) {
          // Then go to next page
          this.router.navigate(['/sessions', 'session-selected'], {queryParams: {accountId: this.accountId}});

        } else {
          this.appService.toast('Something went wrong with updating the account', ToastLevel.WARN, 'Update account');
        }
       } catch (err) {
        this.appService.toast(err, ToastLevel.ERROR);
      }
    } else {
      this.appService.toast('Add at least one role to the account', ToastLevel.WARN, 'Add Role to Account');
    }
  }

  // Decorate the roles with the arn
  generateRolesFromNames(accountNumber) {
    const awsRoles = [];
    awsRoles.push({
      name: this.form.value.role,
      roleArn: `arn:aws:iam::${accountNumber}:role/${this.form.value.role}`
    });
    return awsRoles;
  }

  /**
   * Because the form is complex we need a custom form validation
   * In the future we will put this in a service to create validation factory:
   * this way depending on new accounts we jkust need to pass the form object to the validator
   */
  formValid() {
    return this.providerManagerService.formValid(this.form, this.accountType, this.selectedType);
  }

  setAccountType(name) {
    this.accountType = name;
    this.form.controls['federationUrl'].setValue(this.fedUrl);
  }

  goBack() {
    this.router.navigate(['/sessions', 'session-selected']);
  }
}
