$tests = @(
    "tests/mysql/01-mysql-standalone.spec.ts",
    "tests/mysql/02-mysql-extend.spec.ts", 
    "tests/mysql/03-mysql-public-ip.spec.ts",
    "tests/mysql/04-mysql-change-bandwidth.spec.ts",
    "tests/mysql/05-mysql-disable-public-ip.spec",
    "tests/mysql/06-mysql-create-user.spec.ts",
    "tests/mysql/07-mysql-db-create.spec.ts",
    "tests/mysql/08-mysql-edit-vm-settings.spec.ts",
    "tests/mysql/09-mysql-delete-cluster.spec.ts"
)

foreach ($test in $tests) {
    Write-Host "Запуск: $test" -ForegroundColor Yellow
    $process = Start-Process -FilePath "npx" -ArgumentList "playwright test $test --workers=1" -Wait -PassThru
    
    if ($process.ExitCode -eq 0) {
        Write-Host "Успешно: $test" -ForegroundColor Green
    } else {
        Write-Host "Ошибка в: $test" -ForegroundColor Red
        break
    }
    
    Start-Sleep -Seconds 2
}