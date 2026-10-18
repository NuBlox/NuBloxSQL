import {capabilitySet} from '../../core/capabilities.js';
/** Limited experimental feature set; actual support is version-qualified by live tests. */
export const mysqlCapabilities=capabilitySet('sql.server-prepared','sql.transaction','sql.metadata.basic');
