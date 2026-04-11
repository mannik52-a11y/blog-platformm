const { Sequelize } = require('sequelize');
require('dotenv').config();

// Подключение к MySQL
const sequelize = new Sequelize(
    process.env.DB_NAME || 'blog_platform',
    process.env.DB_USER || 'root',
    process.env.DB_PASSWORD || '',
    {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: false,
        define: {
            timestamps: true,
            underscored: true
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

// Проверка подключения
const testConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ Подключение к MySQL успешно установлено');
    } catch (error) {
        console.error('❌ Ошибка подключения к MySQL:', error.message);
        console.log('⚠️  Проверьте:');
        console.log('   1. Запущен ли MySQL/XAMPP/WAMP');
        console.log('   2. Правильные ли данные в .env файле');
        console.log('   3. Создана ли база данных blog_platform');
    }
};

testConnection();

module.exports = sequelize;
