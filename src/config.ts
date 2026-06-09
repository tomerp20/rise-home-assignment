export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  dbPath: process.env.DB_PATH ?? './data/campaigns.sqlite',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  storage: (process.env.STORAGE ?? 'sqlite') as 'sqlite' | 'dynamodb',
  tableName: process.env.TABLE_NAME ?? 'campaigns',
};
