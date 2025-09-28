/**
 * Утилиты для генерации тестовых данных
 */

/**
 * Генерирует случайное целосотнее число в заданном диапазоне
 * @param min минимальное значение (включительно)
 * @param max максимальное значение (включительно) 
 * @returns случайное целосотнее число (200, 300, 400, ..., 10000)
 */
export function getRandomBandwidth(min: number, max: number): number {
  const randomValue = Math.floor(Math.random() * ((max - min) / 100 + 1)) * 100 + min;
  return randomValue;
}

/**
 * Генерирует случайное имя пользователя
 * Латинские буквы, цифры, дефис, подчеркивание; начинается с буквы, цифры или подчеркивания; длина от 1 до 32 символов
 * @returns случайное имя пользователя
 */
export function generateRandomUsername(): string {
  const firstChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
  const allChars = firstChars + '-';
  
  let username = firstChars.charAt(Math.floor(Math.random() * firstChars.length));
  
  const length = Math.floor(Math.random() * 31) + 1; // от 1 до 32 символов
  for (let i = 1; i < length; i++) {
    username += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  return username;
}

/**
 * Генерирует случайный пароль
 * Длина от 8 до 128 символов
 * @returns случайный пароль
 */
export function generateRandomPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const length = Math.floor(Math.random() * 121) + 8; // от 8 до 128 символов
  
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return password;
}

/**
 * Генерирует случайное имя базы данных
 * Латинские буквы, цифры, подчеркивание; начинается с буквы; длина от 1 до 64 символов
 * @returns случайное имя базы данных
 */
export function generateRandomDatabaseName(): string {
  const firstChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const allChars = firstChars + '0123456789_';
  
  let dbName = firstChars.charAt(Math.floor(Math.random() * firstChars.length));
  
  const length = Math.floor(Math.random() * 63) + 1; // от 1 до 64 символов
  for (let i = 1; i < length; i++) {
    dbName += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  return dbName;
}

/**
 * Генерирует случайное имя кластера/сервиса
 * Латинские буквы, цифры, дефис; начинается с буквы; длина от 3 до 63 символов
 * @param prefix префикс для имени (например, "mysql", "redis")
 * @returns случайное имя кластера
 */
export function generateRandomClusterName(prefix: string = 'test'): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-';
  
  let name = prefix + '-';
  const length = Math.floor(Math.random() * 10) + 8; // от 8 до 18 символов после префикса
  
  for (let i = 0; i < length; i++) {
    name += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return name;
}

/**
 * Генерирует случайный IP адрес
 * @returns случайный IP адрес в формате "192.168.1.1"
 */
export function generateRandomIP(): string {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

/**
 * Генерирует случайный порт
 * @param min минимальный порт (по умолчанию 1024)
 * @param max максимальный порт (по умолчанию 65535)
 * @returns случайный порт
 */
export function generateRandomPort(min: number = 1024, max: number = 65535): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}