const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Модель пользователя
const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
            len: [3, 50]
        }
    },
    email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    avatar: {
        type: DataTypes.STRING(255),
        defaultValue: 'default-avatar.png'
    },
    bio: {
        type: DataTypes.TEXT,
        defaultValue: ''
    },
    role: {
        type: DataTypes.ENUM('user', 'admin'),
        defaultValue: 'user'
    }
});

// Модель статьи
const Article = sequelize.define('Article', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    category: {
        type: DataTypes.STRING(50),
        defaultValue: 'uncategorized'
    },
    tags: {
        type: DataTypes.TEXT,
        defaultValue: '',
        get() {
            const rawValue = this.getDataValue('tags');
            return rawValue ? rawValue.split(',') : [];
        },
        set(value) {
            this.setDataValue('tags', Array.isArray(value) ? value.join(',') : value);
        }
    },
    views: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    likesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('draft', 'published'),
        defaultValue: 'published'
    }
});

// Модель комментария
const Comment = sequelize.define('Comment', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    }
});

// Модель лайка
const Like = sequelize.define('Like', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    }
});

// Установка связей
User.hasMany(Article, { as: 'articles', foreignKey: 'authorId', onDelete: 'CASCADE' });
Article.belongsTo(User, { as: 'author', foreignKey: 'authorId' });

User.hasMany(Comment, { as: 'comments', foreignKey: 'userId', onDelete: 'CASCADE' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'userId' });

Article.hasMany(Comment, { as: 'comments', foreignKey: 'articleId', onDelete: 'CASCADE' });
Comment.belongsTo(Article, { as: 'article', foreignKey: 'articleId' });

User.belongsToMany(Article, { through: Like, as: 'likedArticles', foreignKey: 'userId' });
Article.belongsToMany(User, { through: Like, as: 'likedBy', foreignKey: 'articleId' });

module.exports = {
    sequelize,
    User,
    Article,
    Comment,
    Like
};
