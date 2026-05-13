const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const { engine } = require('express-handlebars');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const app = express();

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// Запрещенные слова
const bannedWords = ['спам', 'реклама', 'порно', 'наркотики', 'насилие', 'экстремизм', 'мат'];

function containsBannedWords(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return bannedWords.some(word => lowerText.includes(word));
}

// Handlebars
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    helpers: {
        eq: (a, b) => a === b,
        formatDate: (date) => new Date(date).toLocaleDateString('ru-RU'),
        truncate: (str, len) => str?.length > len ? str.substring(0, len) + '...' : str
    }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

app.use(session({
    secret: 'secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(flash());

app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.user = req.session.user || null;
    res.locals.isAdmin = req.session.user && req.session.user.role === 'admin';
    next();
});

const categories = [
    'Технологии', 'Путешествия', 'Кулинария', 'Спорт', 'Музыка',
    'Кино', 'Книги', 'Искусство', 'Наука', 'Образование'
];

let users = [];
let articles = [];
let comments = [];
let likes = [];

const initAdmin = async () => {
    const existingAdmin = users.find(u => u.role === 'admin');
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('123', 10);
        users.push({
            id: users.length + 1,
            username: 'admin',
            email: 'admin@blog.com',
            password: hashedPassword,
            role: 'admin',
            status: 'active',
            avatar: '/uploads/default-avatar.png',
            createdAt: new Date()
        });
        console.log('✅ Админ создан: admin / 123');
    }
};

const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Войдите в систему');
    res.redirect('/login');
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Доступ только для администратора');
    res.redirect('/');
};

const isNotBanned = (req, res, next) => {
    const user = users.find(u => u.id === req.session.user?.id);
    if (user && user.status === 'banned') {
        req.session.destroy();
        req.flash('error', 'Ваш аккаунт заблокирован');
        return res.redirect('/login');
    }
    next();
};

// ============= ГЛАВНАЯ =============
app.get('/', (req, res) => {
    const allTags = [];
    articles.forEach(article => {
        if (article.tags && article.tags.length) allTags.push(...article.tags);
    });
    const tagCount = {};
    allTags.forEach(tag => { tagCount[tag] = (tagCount[tag] || 0) + 1; });
    const popularTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

    const publishedArticles = articles.filter(a => a.status === 'published');

    res.render('home', {
        title: 'Главная',
        categories,
        recentArticles: publishedArticles.slice(-6).reverse(),
        stats: { articles: publishedArticles.length, users: users.filter(u => u.role !== 'admin').length, comments: comments.length, likes: likes.length },
        popularTags
    });
});

// ============= АДМИН-ПАНЕЛЬ =============
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    const pendingArticles = articles.filter(a => a.status === 'pending');
    const allUsers = users.filter(u => u.role !== 'admin');
    const allComments = comments.map(c => ({ ...c, author: users.find(u => u.id === c.userId) }));

    res.render('admin/dashboard', {
        title: 'Админ-панель',
        pendingArticles,
        users: allUsers,
        articles: articles,
        comments: allComments,
        stats: {
            pending: pendingArticles.length,
            users: allUsers.length,
            articles: articles.length,
            comments: comments.length
        }
    });
});

app.post('/admin/articles/:id/approve', isAuthenticated, isAdmin, (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (article) {
        article.status = 'published';
        req.flash('success', 'Статья одобрена');
    }
    res.redirect('/admin');
});

app.post('/admin/articles/:id/reject', isAuthenticated, isAdmin, (req, res) => {
    const index = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (index !== -1) {
        articles.splice(index, 1);
        req.flash('success', 'Статья отклонена');
    }
    res.redirect('/admin');
});

app.delete('/admin/articles/:id', isAuthenticated, isAdmin, (req, res) => {
    const index = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (index !== -1) {
        const articleId = articles[index].id;
        articles.splice(index, 1);
        comments = comments.filter(c => c.articleId !== articleId);
        likes = likes.filter(l => l.articleId !== articleId);
        req.flash('success', 'Статья удалена');
    }
    res.redirect('/admin');
});

app.delete('/admin/comments/:id', isAuthenticated, isAdmin, (req, res) => {
    const index = comments.findIndex(c => c.id === parseInt(req.params.id));
    if (index !== -1) comments.splice(index, 1);
    req.flash('success', 'Комментарий удален');
    res.redirect('/admin');
});

app.post('/admin/users/:id/ban', isAuthenticated, isAdmin, (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user && user.role !== 'admin') {
        user.status = 'banned';
        req.flash('success', `Пользователь ${user.username} заблокирован`);
    }
    res.redirect('/admin');
});

app.post('/admin/users/:id/unban', isAuthenticated, isAdmin, (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user && user.role !== 'admin') {
        user.status = 'active';
        req.flash('success', `Пользователь ${user.username} разблокирован`);
    }
    res.redirect('/admin');
});

// ============= СТАТЬИ =============
app.get('/articles', (req, res) => {
    let { sort, search, category, author, tag } = req.query;
    let filtered = articles.filter(a => a.status === 'published');
    
    if (req.session.user && req.session.user.role === 'admin') filtered = [...articles];

    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(a => a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s));
    }
    if (category && category !== 'all') filtered = filtered.filter(a => a.category === category);
    if (author) filtered = filtered.filter(a => a.author.username.toLowerCase().includes(author.toLowerCase()));
    if (tag) filtered = filtered.filter(a => a.tags && a.tags.includes(tag));

    if (sort === 'newest') {
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sort === 'oldest') {
        filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sort === 'most_liked') {
        filtered.sort((a, b) => likes.filter(l => l.articleId === b.id).length - likes.filter(l => l.articleId === a.id).length);
    }

    filtered = filtered.map(a => ({ ...a, likesCount: likes.filter(l => l.articleId === a.id).length }));

    res.render('articles/list', { title: 'Статьи', articles: filtered, categories, sort, search, category, author });
});

app.get('/articles/create', isAuthenticated, isNotBanned, (req, res) => {
    res.render('articles/create', { title: 'Новая статья', categories });
});

app.post('/articles', isAuthenticated, isNotBanned, upload.single('image'), (req, res) => {
    const { title, content, category, tags } = req.body;
    const tagsArray = tags ? tags.split(',').map(t => t.trim()) : [];

    const hasBannedWords = containsBannedWords(title) || containsBannedWords(content);
    const status = hasBannedWords ? 'rejected' : 'pending';

    articles.push({
        id: articles.length + 1,
        title,
        content,
        category: category || 'Без категории',
        tags: tagsArray,
        image: req.file ? '/uploads/' + req.file.filename : null,
        author: { id: req.session.user.id, username: req.session.user.username },
        createdAt: new Date(),
        views: 0,
        status: status
    });

    req.flash(hasBannedWords ? 'error' : 'success', hasBannedWords ? 'Статья содержит запрещенные слова' : 'Статья отправлена на модерацию');
    res.redirect('/articles');
});

app.get('/articles/:id', (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article) {
        req.flash('error', 'Статья не найдена');
        return res.redirect('/articles');
    }

    const isAuthor = req.session.user && article.author.id === req.session.user.id;
    const isAdminUser = req.session.user && req.session.user.role === 'admin';

    if (article.status !== 'published' && !isAuthor && !isAdminUser) {
        req.flash('error', 'Статья на модерации');
        return res.redirect('/articles');
    }

    article.views++;
    const articleLikes = likes.filter(l => l.articleId === article.id);
    const userLiked = req.session.user ? articleLikes.some(l => l.userId === req.session.user.id) : false;
    const articleComments = comments.filter(c => c.articleId === article.id).map(c => ({ ...c, author: users.find(u => u.id === c.userId) }));

    res.render('articles/single', { title: article.title, article: { ...article, likesCount: articleLikes.length, userLiked }, comments: articleComments.reverse(), isAuthor, isAdmin: isAdminUser });
});

app.get('/articles/:id/edit', isAuthenticated, isNotBanned, (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article || article.author.id !== req.session.user.id) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }
    res.render('articles/edit', { title: 'Редактировать', article, categories });
});

app.put('/articles/:id', isAuthenticated, isNotBanned, upload.single('image'), (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article || article.author.id !== req.session.user.id) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }

    const { title, content, category, tags } = req.body;
    article.title = title;
    article.content = content;
    article.category = category || 'Без категории';
    article.tags = tags ? tags.split(',').map(t => t.trim()) : [];
    if (req.file) article.image = '/uploads/' + req.file.filename;
    article.updatedAt = new Date();
    article.status = 'pending';

    req.flash('success', 'Статья обновлена и отправлена на модерацию');
    res.redirect(`/articles/${article.id}`);
});

app.delete('/articles/:id', isAuthenticated, (req, res) => {
    const index = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (index === -1) {
        req.flash('error', 'Статья не найдена');
        return res.redirect('/articles');
    }
    const article = articles[index];
    const isAuthor = article.author.id === req.session.user.id;
    const isAdminUser = req.session.user && req.session.user.role === 'admin';

    if (!isAuthor && !isAdminUser) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }

    const articleId = article.id;
    articles.splice(index, 1);
    comments = comments.filter(c => c.articleId !== articleId);
    likes = likes.filter(l => l.articleId !== articleId);
    req.flash('success', 'Статья удалена');
    res.redirect('/articles');
});

// ============= ЛАЙКИ =============
app.post('/articles/:id/like', isAuthenticated, isNotBanned, (req, res) => {
    const articleId = parseInt(req.params.id);
    const userId = req.session.user.id;
    const existing = likes.find(l => l.articleId === articleId && l.userId === userId);

    if (existing) {
        likes = likes.filter(l => !(l.articleId === articleId && l.userId === userId));
    } else {
        likes.push({ id: likes.length + 1, articleId, userId });
    }
    res.redirect(`/articles/${articleId}`);
});

// ============= КОММЕНТАРИИ =============
app.post('/articles/:id/comments', isAuthenticated, isNotBanned, (req, res) => {
    const { content } = req.body;
    if (containsBannedWords(content)) {
        req.flash('error', 'Комментарий содержит запрещенные слова');
        return res.redirect(`/articles/${req.params.id}`);
    }

    comments.push({
        id: comments.length + 1,
        articleId: parseInt(req.params.id),
        userId: req.session.user.id,
        content: content,
        createdAt: new Date()
    });
    req.flash('success', 'Комментарий добавлен');
    res.redirect(`/articles/${req.params.id}`);
});

app.post('/comments/:id/delete', isAuthenticated, (req, res) => {
    const index = comments.findIndex(c => c.id === parseInt(req.params.id));
    if (index === -1) {
        req.flash('error', 'Комментарий не найден');
        return res.redirect('back');
    }
    const comment = comments[index];
    const article = articles.find(a => a.id === comment.articleId);
    const isAuthor = comment.userId === req.session.user.id;
    const isArticleAuthor = article && article.author.id === req.session.user.id;
    const isAdminUser = req.session.user && req.session.user.role === 'admin';

    if (isAuthor || isArticleAuthor || isAdminUser) {
        comments.splice(index, 1);
        req.flash('success', 'Комментарий удален');
    } else {
        req.flash('error', 'Нет прав');
    }
    res.redirect(`/articles/${comment.articleId}`);
});

// ============= АВТОРИЗАЦИЯ =============
app.get('/register', (req, res) => { res.render('register', { title: 'Регистрация' }); });

app.post('/register', upload.single('avatar'), async (req, res) => {
    const { username, email, password, agree_privacy } = req.body;

    if (!agree_privacy) {
        req.flash('error', 'Вы должны принять условия политики конфиденциальности');
        return res.redirect('/register');
    }

    if (users.find(u => u.email === email)) {
        req.flash('error', 'Пользователь уже существует');
        return res.redirect('/register');
    }
    if (users.find(u => u.username === username)) {
        req.flash('error', 'Имя пользователя уже занято');
        return res.redirect('/register');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({
        id: users.length + 1,
        username,
        email,
        password: hashedPassword,
        role: 'user',
        status: 'active',
        avatar: req.file ? '/uploads/' + req.file.filename : '/uploads/default-avatar.png',
        createdAt: new Date(),
        privacyAccepted: new Date()
    });
    req.flash('success', 'Регистрация успешна!');
    res.redirect('/login');
});

app.get('/login', (req, res) => { res.render('login', { title: 'Вход' }); });

app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    const user = users.find(u => u.email === login || u.username === login);

    if (user && await bcrypt.compare(password, user.password)) {
        if (user.status === 'banned') {
            req.flash('error', 'Аккаунт заблокирован');
            return res.redirect('/login');
        }
        req.session.user = { id: user.id, username: user.username, email: user.email, avatar: user.avatar, role: user.role };
        req.flash('success', `Добро пожаловать, ${user.username}!`);
        return user.role === 'admin' ? res.redirect('/admin') : res.redirect('/');
    } else {
        req.flash('error', 'Неверный логин/email или пароль');
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/profile/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
        req.flash('error', 'Пользователь не найден');
        return res.redirect('/');
    }

    const userArticles = articles.filter(a => a.author.id === user.id && a.status === 'published');
    const userComments = comments.filter(c => c.userId === user.id).map(c => ({ ...c, article: articles.find(a => a.id === c.articleId) }));
    const receivedLikes = likes.filter(l => {
        const article = articles.find(a => a.id === l.articleId);
        return article && article.author.id === user.id;
    }).length;

    res.render('profile', {
        title: user.username,
        profileUser: user,
        articles: userArticles,
        comments: userComments,
        stats: { articles: userArticles.length, comments: userComments.length, likes: receivedLikes },
        isOwnProfile: req.session.user && req.session.user.id === user.id
    });
});

app.post('/profile/:id/avatar', isAuthenticated, upload.single('avatar'), (req, res) => {
    if (req.session.user.id !== parseInt(req.params.id)) {
        req.flash('error', 'Нет прав');
        return res.redirect('back');
    }
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user && req.file) {
        user.avatar = '/uploads/' + req.file.filename;
        req.session.user.avatar = user.avatar;
        req.flash('success', 'Аватар обновлен');
    }
    res.redirect(`/profile/${req.params.id}`);
});

initAdmin().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Сервер: http://localhost:${PORT}`));
});