const ActiveDirectory = require('activedirectory2');
require('dotenv').config();

const ldapUrl = process.env.LADP_URL || process.env.LDAP_URL || 'ldap://10.0.1.73';
const baseDN = process.env.BASE_DN || 'dc=RANE,dc=com';

let ad = null;

function getADInstance() {
  if (!ad) {
    ad = new ActiveDirectory({
      url: ldapUrl,
      baseDN: baseDN,
    });
  }
  return ad;
}

// Separate instance for SEARCH operations (e.g. userExists), which - unlike
// authenticate() - needs the client itself bound with real credentials; most
// AD servers reject anonymous search. Uses a read-only service account if
// one is configured (AD_SERVICE_USER / AD_SERVICE_PASSWORD in .env), falling
// back to the same anonymous config authenticate() uses in case this AD
// server happens to allow anonymous search. If neither works, userExists()
// below surfaces the real LDAP error so it's obvious which is needed.
let adSearch = null;

function getADSearchInstance() {
  if (!adSearch) {
    const serviceUser = process.env.AD_SERVICE_USER;
    const servicePassword = process.env.AD_SERVICE_PASSWORD;
    adSearch = new ActiveDirectory({
      url: ldapUrl,
      baseDN: baseDN,
      ...(serviceUser && servicePassword
        ? { username: serviceUser, password: servicePassword }
        : {}),
    });
  }
  return adSearch;
}

/**
 * Existence-only check: does this Emp_No/username correspond to a real AD
 * account? Does NOT check any password - for bulk employee upload, where
 * whoever fills the spreadsheet has no way to know each new hire's live AD
 * password.
 * @param {string} username - Employee code or UPN
 * @returns {Promise<{ exists: boolean, error?: any, userPrincipalName: string }>}
 */
function checkUserExistsInAD(username) {
  return new Promise((resolve) => {
    if (!username) {
      return resolve({ exists: false, error: 'Username is required' });
    }
    const cleanUsername = username.trim();
    const userPrincipalName = cleanUsername.includes('@')
      ? cleanUsername
      : `${cleanUsername}@rane.com`;

    try {
      const adInstance = getADSearchInstance();
      adInstance.userExists(userPrincipalName, (err, exists) => {
        if (err) {
          console.error(`[AD Lookup] Existence check error for ${userPrincipalName}:`, err.message || err);
          return resolve({ exists: false, error: err, userPrincipalName });
        }
        resolve({ exists: !!exists, userPrincipalName });
      });
    } catch (ex) {
      console.error('[AD Lookup] Unexpected exception during existence check:', ex);
      resolve({ exists: false, error: ex, userPrincipalName });
    }
  });
}

/**
 * Authenticate user credentials against Active Directory
 * @param {string} username - Employee code or UPN (e.g. 10007449 or 10007449@rane.com)
 * @param {string} password - User password
 * @returns {Promise<{ authenticated: boolean, error?: any, userPrincipalName: string }>}
 */
function authenticateAD(username, password) {
  return new Promise((resolve) => {
    if (!username || !password) {
      return resolve({ authenticated: false, error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    const userPrincipalName = cleanUsername.includes('@')
      ? cleanUsername
      : `${cleanUsername}@rane.com`;

    try {
      const adInstance = getADInstance();
      adInstance.authenticate(userPrincipalName, password, (err, auth) => {
        if (err) {
          console.error(`[AD Auth] Authentication error for ${userPrincipalName}:`, err.message || err);
          return resolve({ authenticated: false, error: err, userPrincipalName });
        }

        if (auth) {
          console.log(`[AD Auth] Authenticated successfully for ${userPrincipalName}`);
          return resolve({ authenticated: true, auth, userPrincipalName });
        } else {
          console.warn(`[AD Auth] Authentication failed for ${userPrincipalName}`);
          return resolve({ authenticated: false, error: 'Authentication failed', userPrincipalName });
        }
      });
    } catch (ex) {
      console.error('[AD Auth] Unexpected exception during authentication:', ex);
      return resolve({ authenticated: false, error: ex, userPrincipalName });
    }
  });
}

module.exports = { authenticateAD, checkUserExistsInAD };
