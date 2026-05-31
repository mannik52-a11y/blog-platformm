const { DataTypes } = require('sequelize');
const db = require('../config/database');

// Если база данных не настроена, экспортируем пустые объекты
if (!db.sequelize || !db.sequelize.define) {
    module.exports = {
        sequelize: { sync: async () => {} },
        User: {},
        Article: {},
        Comment: {},
        Like: {},
        Favorite: {}
    };
    console.log('⚠️ Работаем в режиме JSON (без базы данных)');
    process.exit(0);
}

const sequelize = db.sequelize;

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    password: { type: DataTypes.STRING(255), allowNull: false },
    role: { type: DataTypes.ENUM('user', 'admin'), defaultValue: 'user' },
    status: { type: DataTypes.ENUM('active', 'banned'), defaultValue: 'active' },
    avatar: { type: DataTypes.STRING(255), defaultValue: '/uploads/default-avatar.png' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    privacyAccepted: { type: DataTypes.DATE, allowNull: true, field: 'privacy_accepted' }
}, { tableName: 'users', timestamps: false });

const Article = sequelize.define('Article', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    category: { type: DataTypes.STRING(50), defaultValue: 'Без категории' },
    tags: { type: DataTypes.TEXT, defaultValue: '' },
    images: { type: DataTypes.TEXT, defaultValue: '[]' },
    video_url: { type: DataTypes.STRING(500), allowNull: true },
    image: { type: DataTypes.STRING(255), allowNull: true },
    views: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('pending', 'published', 'rejected'), defaultValue: 'pending' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: true, field: 'updated_at' }
}, { tableName: 'articles', timestamps: false });

const Comment = sequelize.define('Comment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' }
}, { tableName: 'comments', timestamps: false });

const Like = sequelize.define('Like', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
}, { tableName: 'likes', timestamps: false });

const Favorite = sequelize.define('Favorite', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' }
}, { tableName: 'favorites', timestamps: false });

User.hasMany(Article, { as: 'articles', foreignKey: 'author_id', onDelete: 'CASCADE' });
Article.belongsTo(User, { as: 'author', foreignKey: 'author_id' });

User.hasMany(Comment, { as: 'comments', foreignKey: 'user_id', onDelete: 'CASCADE' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'user_id' });

Article.hasMany(Comment, { as: 'comments', foreignKey: 'article_id', onDelete: 'CASCADE' });
Comment.belongsTo(Article, { as: 'article', foreignKey: 'article_id' });

User.belongsToMany(Article, { through: Like, as: 'likedArticles', foreignKey: 'user_id' });
Article.belongsToMany(User, { through: Like, as: 'likedBy', foreignKey: 'article_id' });

User.belongsToMany(Article, { through: Favorite, as: 'favorites', foreignKey: 'user_id' });
Article.belongsToMany(User, { through: Favorite, as: 'favoritedBy', foreignKey: 'article_id' });

module.exports = { sequelize, User, Article, Comment, Like, Favorite };
