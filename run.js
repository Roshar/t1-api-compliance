const { execSync } = require('child_process');

const tests = [
  'tests/mysql/01-mysql-standalone.spec.ts',
  'tests/mysql/02-mysql-extend.spec.ts',
  'tests/mysql/03-mysql-public-ip.spec.ts',
  'tests/mysql/04-mysql-change-bandwidth.spec.ts',
  'tests/mysql/05-mysql-disable-public-ip.spec',
  'tests/mysql/06-mysql-create-user.spec.ts',
  'tests/mysql/07-mysql-db-create.spec.ts',
  'tests/mysql/08-mysql-edit-vm-settings.spec.ts',
  'tests/mysql/09-mysql-delete-cluster.spec.ts'
];

console.log('🚀 Starting MySQL tests sequence...\n');

for (let i = 0; i < tests.length; i++) {
  const test = tests[i];
  console.log(`[${i + 1}/${tests.length}] Running: ${test}`);
  
  try {
    execSync(`npx playwright test ${test} --workers=1`, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log(`✅ ${test} - PASSED\n`);
  } catch (error) {
    console.log(`❌ ${test} - FAILED`);
    console.log('Stopping sequence due to error');
    process.exit(1);
  }
}

console.log('🎉 All tests completed!');