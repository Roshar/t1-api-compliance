@echo off
echo MySQL Test Sequence
echo.

echo [1/9] Creating cluster...
npx playwright test tests/mysql/01-mysql-standalone.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 1
    exit /b %errorlevel%
)

echo [2/9] Extending disk...
npx playwright test tests/mysql/02-mysql-extend.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 2
    exit /b %errorlevel%
)

echo [3/9] Enabling Public IP...
npx playwright test tests/mysql/03-mysql-public-ip.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 3
    exit /b %errorlevel%
)

echo [4/9] Changing bandwidth...
npx playwright test tests/mysql/04-mysql-change-bandwidth.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 4
    exit /b %errorlevel%
)

echo [5/9] Disabling Public IP...
npx playwright test tests/mysql/05-mysql-disable-public-ip.spec --workers=1
if %errorlevel% neq 0 (
    echo Error in test 5
    exit /b %errorlevel%
)

echo [6/9] Creating user...
npx playwright test tests/mysql/06-mysql-create-user.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 6
    exit /b %errorlevel%
)

echo [7/9] Creating database...
npx playwright test tests/mysql/07-mysql-db-create.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 7
    exit /b %errorlevel%
)

echo [8/9] Changing VM settings...
npx playwright test tests/mysql/08-mysql-edit-vm-settings.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 8
    exit /b %errorlevel%
)

echo [9/9] Deleting cluster...
npx playwright test tests/mysql/09-mysql-delete-cluster.spec.ts --workers=1
if %errorlevel% neq 0 (
    echo Error in test 9
    exit /b %errorlevel%
)

echo.
echo All tests completed successfully!
pause