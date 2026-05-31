const { Sequelize } = require('sequelize');
require('dotenv').config();

// Проверяем, есть ли DATABASE_URL в .env
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.log('⚠️ DATABASE_URL не указан, используем JSON-режим');
    // Возвращаем заглушку, чтобы не было ошибки
    module.exports = {
        sequelize: {
            authenticate: async () => {},
            sync: async () => {},
            define: () => {}
        },
        User: {},
        Article: {},
        Comment: {},
        Like: {},
        Favorite: {}
    };
} else {
    const sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        logging: false,
        define: {
            timestamps: true,
            underscored: true
        },
        dialectOptions: {
            ssl: process.env.RENDER === 'true' ? {
                require: true,
                rejectUnauthorized: false
            } : {}
        }
    });

    module.exports = { sequelize };
}
