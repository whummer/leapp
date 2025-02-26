import PluginStatus from "../models/plugin-status";
import Segment from "../models/segment";
import { LeappNotification } from "../models/notification";

export interface GlobalSettings {
  defaultRegion: string;
  defaultLocation: string;
  macOsTerminal: string;
  pluginsStatus: PluginStatus[];
  pinned: string[];
  segments: Segment[];
  colorTheme: string;
  extensionEnabled: boolean;
  credentialMethod: string;
  samlRoleSessionDuration: number;
  ssmRegionBehaviour: string;
  notifications: LeappNotification[];
  requirePassword: number;
  touchIdEnabled: boolean;
}
