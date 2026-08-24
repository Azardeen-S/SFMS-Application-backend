const { handleLineStoppageCreateFTP, handleLineStoppageCloseFTP } = require('./utils/ftpService');

async function testFTP() {
  console.log('Testing FTP service module syntax & loading...');
  if (typeof handleLineStoppageCreateFTP === 'function' && typeof handleLineStoppageCloseFTP === 'function') {
    console.log('FTP helper functions exported correctly.');
  } else {
    console.error('FTP helper functions missing.');
  }
  process.exit(0);
}

testFTP();
