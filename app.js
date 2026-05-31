require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const { engine } = require('express-handlebars');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

if (!fs.existsSync('public/uploads')) {
    fs.mkdirSync('public/uploads', { recursive: true });
}

// Настройка почты
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.mail.ru',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Хранилище для кодов восстановления
let resetTokens = [];

// Функция отправки email
async function sendResetEmail(email, code, username) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f0eb; border-radius: 12px;">
            <h1 style="color: #2c2825;">Восстановление пароля</h1>
            <p>Здравствуйте, <strong>${username}</strong>!</p>
            <p>Вы запросили восстановление пароля на сайте <strong>БлогПлатформа</strong>.</p>
            <p>Ваш код для восстановления:</p>
            <div style="background: #c47a5a; color: white; padding: 15px; font-size: 32px; text-align: center; letter-spacing: 5px; border-radius: 8px; margin: 20px 0;">
                ${code}
            </div>
            <p>Введите этот код на странице восстановления пароля.</p>
            <p>Код действителен в течение 15 минут.</p>
            <p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
            <hr style="border: none; border-top: 1px solid #e8e0d8; margin: 20px 0;">
            <p style="color: #6b635c; font-size: 12px;">© 2026 БлогПлатформа — место для ваших мыслей</p>
        </div>
    `;
    
    await transporter.sendMail({
        from: `"БлогПлатформа" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Восстановление пароля',
        html: html
    });
}

// Функция для генерации 6-значного кода
function generateResetCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// JSON хранилище
const DATA_FILE = path.join(__dirname, 'data.json');

let users = [];
let articles = [];
let comments = [];
let likes = [];
let favorites = [];

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            users = data.users || [];
            articles = data.articles || [];
            comments = data.comments || [];
            likes = data.likes || [];
            favorites = data.favorites || [];
            resetTokens = data.resetTokens || [];
            console.log(`✅ Загружено: ${users.length} пользователей, ${articles.length} статей`);
        } else {
            saveData();
        }
    } catch (err) {
        console.error('Ошибка загрузки:', err.message);
    }
}

function saveData() {
    const data = { users, articles, comments, likes, favorites, resetTokens };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Данные сохранены');
}

// Handlebars с helpers
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    helpers: {
        eq: (a, b) => a === b,
        or: (a, b) => a || b,
        formatDate: (date) => {
            if (!date) return '';
            return new Date(date).toLocaleDateString('ru-RU');
        },
        truncate: (str, len) => str?.length > len ? str.substring(0, len) + '...' : str,
        getVideoEmbedUrl: (url) => {
            if (!url) return null;
            let match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?\/]+)/);
            if (match) return `https://www.youtube.com/embed/${match[1]}`;
            match = url.match(/vimeo\.com\/(\d+)/);
            if (match) return `https://player.vimeo.com/video/${match[1]}`;
            return null;
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
    secret: process.env.SESSION_SECRET || 'secret_key_2026',
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

const categories = ['Технологии', 'Путешествия', 'Кулинария', 'Спорт', 'Музыка',
    'Кино', 'Книги', 'Искусство', 'Наука', 'Образование'];

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
        req.flash('error', 'Аккаунт заблокирован');
        return res.redirect('/login');
    }
    next();
};

const bannedWords = ['спам', 'реклама', 'порно', 'наркотики', 'насилие', 'экстремизм', 'мат'];

function containsBannedWords(text) {
    if (!text) return false;
    return bannedWords.some(word => text.toLowerCase().includes(word));
}

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
            createdAt: new Date(),
            privacyAccepted: new Date()
        });
        saveData();
        console.log('✅ Админ: admin / 123');
    }
};

// ============= ГЛАВНАЯ =============
app.get('/', (req, res) => {
    const allTags = [];
    articles.forEach(a => { if (a.tags) allTags.push(...a.tags); });
    const tagCount = {};
    allTags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
    const popularTags = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0,10).map(([t,c]) => ({ tag: t, count: c }));
    const published = articles.filter(a => a.status === 'published');
    res.render('home', {
        title: 'Главная', categories,
        recentArticles: published.slice(-6).reverse(),
        stats: {
            articles: published.length,
            users: users.filter(u => u.role !== 'admin').length,
            comments: comments.length,
            likes: likes.length
        },
        popularTags
    });
});

// ============= АВТОРИЗАЦИЯ =============
app.get('/register', (req, res) => { res.render('register', { title: 'Регистрация' }); });
app.post('/register', upload.single('avatar'), async (req, res) => {
    const { username, email, password, agree_privacy } = req.body;
    if (!agree_privacy) {
        req.flash('error', 'Примите условия политики');
        return res.redirect('/register');
    }
    if (users.find(u => u.email === email)) {
        req.flash('error', 'Email уже используется');
        return res.redirect('/register');
    }
    if (users.find(u => u.username === username)) {
        req.flash('error', 'Имя уже занято');
        return res.redirect('/register');
    }
    const hashed = await bcrypt.hash(password, 10);
    users.push({
        id: users.length + 1, username, email, password: hashed,
        role: 'user', status: 'active',
        avatar: req.file ? '/uploads/' + req.file.filename : '/uploads/default-avatar.png',
        createdAt: new Date(), privacyAccepted: new Date()
    });
    saveData();
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
    }
    req.flash('error', 'Неверный логин или пароль');
    res.redirect('/login');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ============= ВОССТАНОВЛЕНИЕ ПАРОЛЯ =============

// Страница запроса восстановления
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { title: 'Восстановление пароля' });
});

// Отправка кода на почту
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    const user = users.find(u => u.email === email);
    if (!user) {
        req.flash('error', 'Пользователь с таким email не найден');
        return res.redirect('/forgot-password');
    }
    
    // Удаляем старые токены для этого пользователя
    resetTokens = resetTokens.filter(t => t.email !== email);
    
    const code = generateResetCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 минут
    
    resetTokens.push({
        email,
        code,
        expiresAt,
        createdAt: new Date()
    });
    saveData();
    
    try {
        await sendResetEmail(email, code, user.username);
        req.flash('success', `Код восстановления отправлен на ${email}`);
        res.redirect('/reset-password');
    } catch (error) {
        console.error('Ошибка отправки email:', error);
        req.flash('error', 'Ошибка при отправке письма. Попробуйте позже.');
        res.redirect('/forgot-password');
    }
});

// Страница ввода кода и нового пароля
app.get('/reset-password', (req, res) => {
    res.render('reset-password', { title: 'Сброс пароля' });
});

// Проверка кода и смена пароля
app.post('/reset-password', async (req, res) => {
    const { email, code, password, confirm_password } = req.body;
    
    if (!email || !code || !password) {
        req.flash('error', 'Заполните все поля');
        return res.redirect('/reset-password');
    }
    
    if (password !== confirm_password) {
        req.flash('error', 'Пароли не совпадают');
        return res.redirect('/reset-password');
    }
    
    if (password.length < 3) {
        req.flash('error', 'Пароль должен быть не менее 3 символов');
        return res.redirect('/reset-password');
    }
    
    const token = resetTokens.find(t => t.email === email && t.code === code);
    
    if (!token) {
        req.flash('error', 'Неверный код восстановления');
        return res.redirect('/reset-password');
    }
    
    if (new Date() > new Date(token.expiresAt)) {
        req.flash('error', 'Код восстановления истёк. Запросите новый.');
        resetTokens = resetTokens.filter(t => t.email !== email);
        saveData();
        return res.redirect('/forgot-password');
    }
    
    const user = users.find(u => u.email === email);
    if (!user) {
        req.flash('error', 'Пользователь не найден');
        return res.redirect('/forgot-password');
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    
    // Удаляем использованный токен
    resetTokens = resetTokens.filter(t => t.email !== email);
    saveData();
    
    req.flash('success', 'Пароль успешно изменён! Теперь вы можете войти.');
    res.redirect('/login');
});

// ============= ИЗБРАННОЕ =============
app.post('/articles/:id/favorite', isAuthenticated, isNotBanned, (req, res) => {
    const articleId = parseInt(req.params.id);
    const userId = req.session.user.id;
    const existing = favorites.find(f => f.userId === userId && f.articleId === articleId);
    if (existing) {
        favorites = favorites.filter(f => !(f.userId === userId && f.articleId === articleId));
        req.flash('success', 'Удалено из избранного');
    } else {
        favorites.push({ id: favorites.length + 1, userId, articleId, createdAt: new Date() });
        req.flash('success', 'Добавлено в избранное');
    }
    saveData();
    res.redirect(`/articles/${articleId}`);
});

app.get('/favorites', isAuthenticated, (req, res) => {
    const userFavorites = favorites.filter(f => f.userId === req.session.user.id);
    const favoriteArticles = [];
    for (let fav of userFavorites) {
        const article = articles.find(a => a.id === fav.articleId && a.status === 'published');
        if (article) {
            favoriteArticles.push({
                ...article,
                likesCount: likes.filter(l => l.articleId === article.id).length
            });
        }
    }
    res.render('favorites', { title: 'Избранное', articles: favoriteArticles });
});

// ============= СТАТЬИ =============
app.get('/articles', (req, res) => {
    let { sort, search, category, author, tag } = req.query;
    let filtered = articles.filter(a => a.status === 'published');
    if (req.session.user?.role === 'admin') filtered = [...articles];
    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(a => a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s));
    }
    if (category && category !== 'all') filtered = filtered.filter(a => a.category === category);
    if (author) filtered = filtered.filter(a => a.author.username.toLowerCase().includes(author.toLowerCase()));
    if (tag) filtered = filtered.filter(a => a.tags?.includes(tag));
    if (sort === 'newest') filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'oldest') filtered.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sort === 'most_liked') filtered.sort((a,b) => likes.filter(l=>l.articleId===b.id).length - likes.filter(l=>l.articleId===a.id).length);
    const userFavs = req.session.user ? favorites.filter(f => f.userId === req.session.user.id).map(f => f.articleId) : [];
    filtered = filtered.map(a => ({
        ...a,
        likesCount: likes.filter(l => l.articleId === a.id).length,
        isFavorite: userFavs.includes(a.id)
    }));
    res.render('articles/list', { title: 'Статьи', articles: filtered, categories, sort, search, category, author });
});

app.get('/articles/create', isAuthenticated, isNotBanned, (req, res) => {
    res.render('articles/create', { title: 'Новая статья', categories });
});

app.post('/articles', isAuthenticated, isNotBanned, upload.array('images', 10), (req, res) => {
    const { title, content, category, tags, video_url } = req.body;
    const tagsArr = tags ? tags.split(',').map(t => t.trim()) : [];
    const images = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];
    const hasBanned = containsBannedWords(title) || containsBannedWords(content);
    
    let videoEmbedUrl = null;
    if (video_url && video_url.trim() !== '') {
        let match = video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?\/]+)/);
        if (match) videoEmbedUrl = `https://www.youtube.com/embed/${match[1]}`;
        else {
            match = video_url.match(/vimeo\.com\/(\d+)/);
            if (match) videoEmbedUrl = `https://player.vimeo.com/video/${match[1]}`;
        }
    }
    
    articles.push({
        id: articles.length + 1, title, content, category: category || 'Без категории',
        tags: tagsArr, images: JSON.stringify(images), video_url: videoEmbedUrl,
        video_original_url: video_url || null,
        image: images[0] || null,
        author: { id: req.session.user.id, username: req.session.user.username },
        createdAt: new Date(), views: 0, status: hasBanned ? 'rejected' : 'pending'
    });
    saveData();
    req.flash(hasBanned ? 'error' : 'success', hasBanned ? 'Статья содержит запрещенные слова' : 'Статья на модерации');
    res.redirect('/articles');
});

app.get('/articles/:id', (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article) {
        req.flash('error', 'Статья не найдена');
        return res.redirect('/articles');
    }
    const isAuthor = req.session.user && article.author.id === req.session.user.id;
    const isAdminUser = req.session.user?.role === 'admin';
    if (article.status !== 'published' && !isAuthor && !isAdminUser) {
        req.flash('error', 'Статья на модерации');
        return res.redirect('/articles');
    }
    article.views++;
    const articleLikes = likes.filter(l => l.articleId === article.id);
    const userLiked = req.session.user ? articleLikes.some(l => l.userId === req.session.user.id) : false;
    const isFavorite = req.session.user ? favorites.some(f => f.userId === req.session.user.id && f.articleId === article.id) : false;
    const articleComments = comments.filter(c => c.articleId === article.id).map(c => ({
        ...c, author: users.find(u => u.id === c.userId)
    }));
    let images = [];
    try { images = JSON.parse(article.images || '[]'); } catch(e) {}
    
    res.render('articles/single', {
        title: article.title,
        article: { 
            ...article, 
            likesCount: articleLikes.length, 
            userLiked, 
            isFavorite, 
            images,
            hasVideo: !!article.video_url
        },
        comments: articleComments.reverse(),
        isAuthor, 
        isAdmin: isAdminUser
    });
});

app.get('/articles/:id/edit', isAuthenticated, isNotBanned, (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article || article.author.id !== req.session.user.id) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }
    let images = [];
    try { images = JSON.parse(article.images || '[]'); } catch(e) {}
    res.render('articles/edit', { title: 'Редактировать', article: { ...article, images, video_original_url: article.video_original_url || '' }, categories });
});

app.put('/articles/:id', isAuthenticated, isNotBanned, upload.array('images', 10), (req, res) => {
    const article = articles.find(a => a.id === parseInt(req.params.id));
    if (!article || article.author.id !== req.session.user.id) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }
    const { title, content, category, tags, video_url, existing_images } = req.body;
    const tagsArr = tags ? tags.split(',').map(t => t.trim()) : [];
    let oldImages = [];
    if (existing_images) oldImages = typeof existing_images === 'string' ? [existing_images] : existing_images;
    const newImages = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];
    const allImages = [...oldImages, ...newImages];
    
    let videoEmbedUrl = null;
    if (video_url && video_url.trim() !== '') {
        let match = video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?\/]+)/);
        if (match) videoEmbedUrl = `https://www.youtube.com/embed/${match[1]}`;
        else {
            match = video_url.match(/vimeo\.com\/(\d+)/);
            if (match) videoEmbedUrl = `https://player.vimeo.com/video/${match[1]}`;
        }
    }
    
    article.title = title;
    article.content = content;
    article.category = category || 'Без категории';
    article.tags = tagsArr;
    article.images = JSON.stringify(allImages);
    article.video_url = videoEmbedUrl;
    article.video_original_url = video_url || null;
    article.image = allImages[0] || article.image;
    article.updatedAt = new Date();
    article.status = 'pending';
    saveData();
    req.flash('success', 'Статья обновлена и отправлена на модерацию');
    res.redirect(`/articles/${article.id}`);
});

app.delete('/articles/:id', isAuthenticated, (req, res) => {
    const idx = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (idx === -1) {
        req.flash('error', 'Статья не найдена');
        return res.redirect('/articles');
    }
    const article = articles[idx];
    const isAuthor = article.author.id === req.session.user.id;
    const isAdminUser = req.session.user?.role === 'admin';
    if (!isAuthor && !isAdminUser) {
        req.flash('error', 'Нет прав');
        return res.redirect('/articles');
    }
    const id = article.id;
    articles.splice(idx, 1);
    comments = comments.filter(c => c.articleId !== id);
    likes = likes.filter(l => l.articleId !== id);
    favorites = favorites.filter(f => f.articleId !== id);
    saveData();
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
    saveData();
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
        id: comments.length + 1, articleId: parseInt(req.params.id),
        userId: req.session.user.id, content, createdAt: new Date()
    });
    saveData();
    req.flash('success', 'Комментарий добавлен');
    res.redirect(`/articles/${req.params.id}`);
});

app.post('/comments/:id/delete', isAuthenticated, (req, res) => {
    const idx = comments.findIndex(c => c.id === parseInt(req.params.id));
    if (idx === -1) {
        req.flash('error', 'Комментарий не найден');
        return res.redirect('back');
    }
    const comment = comments[idx];
    const article = articles.find(a => a.id === comment.articleId);
    const isAuthor = comment.userId === req.session.user.id;
    const isArticleAuthor = article && article.author.id === req.session.user.id;
    const isAdminUser = req.session.user?.role === 'admin';
    if (isAuthor || isArticleAuthor || isAdminUser) {
        comments.splice(idx, 1);
        saveData();
        req.flash('success', 'Комментарий удален');
    } else {
        req.flash('error', 'Нет прав');
    }
    res.redirect(`/articles/${comment.articleId}`);
});

// ============= АДМИН-ПАНЕЛЬ =============
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.render('admin/dashboard', {
        title: 'Админ-панель',
        pendingArticles: articles.filter(a => a.status === 'pending'),
        users: users.filter(u => u.role !== 'admin'),
        articles,
        comments: comments.map(c => ({ ...c, author: users.find(u => u.id === c.userId) })),
        stats: {
            pending: articles.filter(a => a.status === 'pending').length,
            users: users.filter(u => u.role !== 'admin').length,
            articles: articles.length,
            comments: comments.length
        }
    });
});

app.post('/admin/articles/:id/approve', isAuthenticated, isAdmin, (req, res) => {
    const a = articles.find(a => a.id === parseInt(req.params.id));
    if (a) { a.status = 'published'; saveData(); req.flash('success', 'Одобрено'); }
    res.redirect('/admin');
});

app.post('/admin/articles/:id/reject', isAuthenticated, isAdmin, (req, res) => {
    const idx = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (idx !== -1) {
        const id = articles[idx].id;
        articles.splice(idx, 1);
        comments = comments.filter(c => c.articleId !== id);
        likes = likes.filter(l => l.articleId !== id);
        favorites = favorites.filter(f => f.articleId !== id);
        saveData();
        req.flash('success', 'Отклонено');
    }
    res.redirect('/admin');
});

app.delete('/admin/articles/:id', isAuthenticated, isAdmin, (req, res) => {
    const idx = articles.findIndex(a => a.id === parseInt(req.params.id));
    if (idx !== -1) {
        const id = articles[idx].id;
        articles.splice(idx, 1);
        comments = comments.filter(c => c.articleId !== id);
        likes = likes.filter(l => l.articleId !== id);
        favorites = favorites.filter(f => f.articleId !== id);
        saveData();
        req.flash('success', 'Удалено');
    }
    res.redirect('/admin');
});

app.delete('/admin/comments/:id', isAuthenticated, isAdmin, (req, res) => {
    const idx = comments.findIndex(c => c.id === parseInt(req.params.id));
    if (idx !== -1) { comments.splice(idx, 1); saveData(); req.flash('success', 'Удалено'); }
    res.redirect('/admin');
});

app.post('/admin/users/:id/ban', isAuthenticated, isAdmin, (req, res) => {
    const u = users.find(u => u.id === parseInt(req.params.id));
    if (u && u.role !== 'admin') { u.status = 'banned'; saveData(); req.flash('success', `Заблокирован ${u.username}`); }
    res.redirect('/admin');
});

app.post('/admin/users/:id/unban', isAuthenticated, isAdmin, (req, res) => {
    const u = users.find(u => u.id === parseInt(req.params.id));
    if (u && u.role !== 'admin') { u.status = 'active'; saveData(); req.flash('success', `Разблокирован ${u.username}`); }
    res.redirect('/admin');
});

// ============= ПРОФИЛЬ =============
app.get('/profile/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
        req.flash('error', 'Пользователь не найден');
        return res.redirect('/');
    }
    const userArticles = articles.filter(a => a.author.id === user.id && a.status === 'published');
    const userComments = comments.filter(c => c.userId === user.id).map(c => ({
        ...c, article: articles.find(a => a.id === c.articleId)
    }));
    const receivedLikes = likes.filter(l => {
        const a = articles.find(a => a.id === l.articleId);
        return a && a.author.id === user.id;
    }).length;
    res.render('profile', {
        title: user.username, profileUser: user,
        articles: userArticles, comments: userComments,
        stats: { articles: userArticles.length, comments: userComments.length, likes: receivedLikes },
        isOwnProfile: req.session.user && req.session.user.id === user.id
    });
});

app.post('/profile/:id/avatar', isAuthenticated, upload.single('avatar'), (req, res) => {
    if (req.session.user.id !== parseInt(req.params.id)) {
        req.flash('error', 'Нет прав');
        return res.redirect('back');
    }
    const u = users.find(u => u.id === parseInt(req.params.id));
    if (u && req.file) {
        u.avatar = '/uploads/' + req.file.filename;
        req.session.user.avatar = u.avatar;
        saveData();
        req.flash('success', 'Аватар обновлен');
    }
    res.redirect(`/profile/${req.params.id}`);
});

const PORT = process.env.PORT || 3000;
loadData();
initAdmin().then(() => {
    app.listen(PORT, () => console.log(`✅ Сервер: http://localhost:${PORT}`));
});
