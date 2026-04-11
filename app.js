require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const { engine } = require('express-handlebars');
const bcrypt = require('bcryptjs');
const { sequelize, User, Article, Comment, Like } = require('./models');

const app = express();

// Настройка Handlebars с безопасным доступом к прототипам
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    partialsDir: path.join(__dirname, 'views/partials'),
    allowProtoPropertiesByDefault: true,
    allowProtoMethodsByDefault: true,
    helpers: {
        eq: (a, b) => a === b,
        gt: (a, b) => a > b,
        lt: (a, b) => a < b,
        formatDate: (date) => {
            if (!date) return '';
            const d = new Date(date);
            return d.toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        },
        truncate: (str, len) => {
            if (!str) return '';
            if (str.length <= len) return str;
            return str.substring(0, len) + '...';
        }
    }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(flash());

app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.user = req.session.user || null;
    next();
});

const categories = [
    { id: 1, name: 'Технологии', slug: 'tech' },
    { id: 2, name: 'Путешествия', slug: 'travel' },
    { id: 3, name: 'Кулинария', slug: 'cooking' },
    { id: 4, name: 'Спорт', slug: 'sports' },
    { id: 5, name: 'Музыка', slug: 'music' },
    { id: 6, name: 'Кино', slug: 'movies' },
    { id: 7, name: 'Книги', slug: 'books' },
    { id: 8, name: 'Искусство', slug: 'art' },
    { id: 9, name: 'Наука', slug: 'science' },
    { id: 10, name: 'Образование', slug: 'education' }
];

const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Необходимо войти');
    res.redirect('/login');
};

app.get('/', async (req, res) => {
    try {
        const articles = await Article.findAll({
            include: [{ model: User, as: 'author' }],
            order: [['createdAt', 'DESC']],
            limit: 5
        });
        
        const stats = {
            articles: await Article.count(),
            users: await User.count(),
            comments: await Comment.count(),
            likes: await Like.count()
        };
        
        const allTags = [];
        const allArticles = await Article.findAll();
        allArticles.forEach(article => {
            if (article.tags && article.tags.length) allTags.push(...article.tags);
        });
        const tagCount = {};
        allTags.forEach(tag => { tagCount[tag] = (tagCount[tag] || 0) + 1; });
        const popularTags = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0,10).map(([tag,count]) => ({ tag, count }));
        
        // Преобразуем статьи в обычные объекты
        const recentArticles = articles.map(article => article.toJSON());
        
        res.render('home', { 
            title: '', 
            message: 'заметки',
            categories, 
            popularTags, 
            recentArticles, 
            stats,
            user: req.session.user
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка');
    }
});

app.get('/register', (req, res) => { res.render('register', { title: 'регистрация' }); });
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existing = await User.findOne({ where: { email } });
        if (existing) { req.flash('error', 'Пользователь существует'); return res.redirect('/register'); }
        const hashed = await bcrypt.hash(password, 10);
        await User.create({ username, email, password: hashed });
        req.flash('success', 'Регистрация успешна');
        res.redirect('/login');
    } catch (error) { req.flash('error', 'Ошибка'); res.redirect('/register'); }
});

app.get('/login', (req, res) => { res.render('login', { title: 'вход' }); });
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ where: { email } });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };
            req.flash('success', `привет, ${user.username}`);
            res.redirect('/');
        } else { req.flash('error', 'Неверные данные'); res.redirect('/login'); }
    } catch (error) { req.flash('error', 'Ошибка'); res.redirect('/login'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/articles', async (req, res) => {
    try {
        const { category, tag, search } = req.query;
        let where = {};
        if (category && category !== 'uncategorized') where.category = category;
        let articles = await Article.findAll({ where, include: [{ model: User, as: 'author' }], order: [['createdAt', 'DESC']] });
        
        let filteredArticles = articles.map(a => a.toJSON());
        
        if (tag) filteredArticles = filteredArticles.filter(a => a.tags && a.tags.includes(tag));
        if (search) {
            const s = search.toLowerCase();
            filteredArticles = filteredArticles.filter(a => a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s));
        }
        
        const articlesWithLikes = await Promise.all(filteredArticles.map(async a => {
            const likesCount = await Like.count({ where: { articleId: a.id } });
            const cat = categories.find(c => c.slug === a.category);
            return { ...a, likesCount, categoryName: cat?.name || '' };
        }));
        
        res.render('articles/list', { title: 'статьи', articles: articlesWithLikes, categories, currentCategory: category, currentTag: tag, searchQuery: search });
    } catch (error) { res.status(500).send('Ошибка'); }
});

app.get('/articles/create', isAuthenticated, (req, res) => { res.render('articles/create', { title: 'новая статья', categories }); });
app.post('/articles', isAuthenticated, async (req, res) => {
    try {
        const { title, content, category, tags } = req.body;
        const tagsArray = tags ? tags.split(',').map(t => t.trim().toLowerCase()) : [];
        await Article.create({ title, content, category: category || 'uncategorized', tags: tagsArray, authorId: req.session.user.id });
        req.flash('success', 'статья создана');
        res.redirect('/articles');
    } catch (error) { req.flash('error', 'Ошибка'); res.redirect('/articles/create'); }
});

app.get('/articles/:id', async (req, res) => {
    try {
        const article = await Article.findByPk(req.params.id, { 
            include: [{ model: User, as: 'author' }, { model: Comment, as: 'comments', include: [{ model: User, as: 'author' }] }] 
        });
        
        if (!article) { req.flash('error', 'Не найдена'); return res.redirect('/articles'); }
        
        article.views += 1; 
        await article.save();
        
        const likesCount = await Like.count({ where: { articleId: article.id } });
        const userLiked = req.session.user ? await Like.findOne({ where: { articleId: article.id, userId: req.session.user.id } }) : false;
        const cat = categories.find(c => c.slug === article.category);
        const similar = await Article.findAll({ where: { category: article.category, id: { [require('sequelize').Op.ne]: article.id } }, limit: 3 });
        
        const articleJson = article.toJSON();
        const similarJson = similar.map(a => a.toJSON());
        const commentsJson = article.comments ? article.comments.map(c => c.toJSON()) : [];
        
        res.render('articles/single', { 
            title: article.title, 
            article: { ...articleJson, likesCount, userLiked: !!userLiked, categoryName: cat?.name || '' }, 
            comments: commentsJson, 
            similarArticles: similarJson, 
            isAuthor: req.session.user && article.authorId === req.session.user.id 
        });
    } catch (error) { 
        console.error(error);
        res.status(500).send('Ошибка'); 
    }
});

app.get('/articles/:id/edit', isAuthenticated, async (req, res) => {
    const article = await Article.findByPk(req.params.id);
    if (!article || article.authorId !== req.session.user.id) { req.flash('error', 'Нет прав'); return res.redirect('/articles'); }
    res.render('articles/edit', { title: 'редактировать', article: article.toJSON(), categories });
});

app.put('/articles/:id', isAuthenticated, async (req, res) => {
    const article = await Article.findByPk(req.params.id);
    if (!article || article.authorId !== req.session.user.id) { req.flash('error', 'Нет прав'); return res.redirect('/articles'); }
    const { title, content, category, tags } = req.body;
    const tagsArray = tags ? tags.split(',').map(t => t.trim().toLowerCase()) : [];
    await article.update({ title, content, category: category || 'uncategorized', tags: tagsArray });
    req.flash('success', 'обновлено');
    res.redirect(`/articles/${article.id}`);
});

app.delete('/articles/:id', isAuthenticated, async (req, res) => {
    const article = await Article.findByPk(req.params.id);
    if (!article || article.authorId !== req.session.user.id) { req.flash('error', 'Нет прав'); return res.redirect('/articles'); }
    await Comment.destroy({ where: { articleId: article.id } });
    await Like.destroy({ where: { articleId: article.id } });
    await article.destroy();
    req.flash('success', 'удалено');
    res.redirect('/articles');
});

app.post('/articles/:id/like', isAuthenticated, async (req, res) => {
    const articleId = req.params.id;
    const userId = req.session.user.id;
    const existing = await Like.findOne({ where: { articleId, userId } });
    if (existing) await existing.destroy();
    else await Like.create({ articleId, userId });
    res.redirect(`/articles/${articleId}`);
});

app.post('/articles/:id/comments', isAuthenticated, async (req, res) => {
    await Comment.create({ content: req.body.content, articleId: req.params.id, userId: req.session.user.id });
    req.flash('success', 'комментарий добавлен');
    res.redirect(`/articles/${req.params.id}`);
});

app.post('/comments/:id/delete', isAuthenticated, async (req, res) => {
    const comment = await Comment.findByPk(req.params.id);
    if (!comment) { req.flash('error', 'Не найден'); return res.redirect('back'); }
    const article = await Article.findByPk(comment.articleId);
    if (comment.userId === req.session.user.id || (article && article.authorId === req.session.user.id)) await comment.destroy();
    else { req.flash('error', 'Нет прав'); return res.redirect('back'); }
    req.flash('success', 'удален');
    res.redirect(`/articles/${comment.articleId}`);
});

app.get('/profile/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = await User.findByPk(userId);
        
        if (!user) { 
            req.flash('error', 'Пользователь не найден'); 
            return res.redirect('/'); 
        }
        
        const articles = await Article.findAll({ 
            where: { authorId: user.id }, 
            include: [{ model: User, as: 'author' }],
            order: [['createdAt', 'DESC']]
        });
        
        const comments = await Comment.findAll({ 
            where: { userId: user.id }, 
            include: [{ model: Article, as: 'article' }],
            order: [['createdAt', 'DESC']]
        });
        
        const stats = { 
            articles: articles.length, 
            comments: comments.length, 
            likes: 0 
        };
        
        // Преобразуем в обычные объекты
        const articlesJson = articles.map(a => a.toJSON());
        const commentsJson = comments.map(c => ({
            ...c.toJSON(),
            article: c.article ? c.article.toJSON() : null
        }));
        
        res.render('profile', { 
            title: user.username,
            profileUser: {
                id: user.id,
                username: user.username,
                email: user.email,
                createdAt: user.createdAt
            },
            articles: articlesJson,
            comments: commentsJson,
            stats: stats,
            categories: categories,
            isOwnProfile: req.session.user && req.session.user.id === user.id,
            user: req.session.user
        });
    } catch (error) {
        console.error('Ошибка в профиле:', error);
        req.flash('error', 'Ошибка загрузки профиля');
        res.redirect('/');
    }
});

const PORT = process.env.PORT || 3000;
sequelize.sync({ alter: true }).then(() => {
    console.log('База данных готова');
    app.listen(PORT, () => console.log(`Сервер на http://localhost:${PORT}`));
}).catch(err => console.error('Ошибка БД:', err));
