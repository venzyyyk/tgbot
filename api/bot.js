const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ID адміністраторів (встав сюди потрібні)
const ADMIN_IDS = [731859824, 6070383336]; 

// Проста функція для перевірки, чи є користувач адміном
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from.id);

// --- КЛАВІАТУРИ ГОЛОВНОГО МЕНЮ ---

// Клавіатура звичайного користувача
const getUserKeyboard = () => {
    return Markup.keyboard([
        ['🎱 Записатися на турнір'],
        ['📞 Зв\'язок']
    ]).resize(); // resize() робить кнопки компактними
};

// Клавіатура адміністратора
const getAdminKeyboard = () => {
    return Markup.keyboard([
        ['🎱 Записатися на турнір', '📞 Зв\'язок'],
        ['➕ Додати турнір', '💬 Чат з користувачами']
    ]).resize();
};

// --- ОБРОБКА КОМАНДИ /start ---
bot.start((ctx) => {
    const userName = ctx.from.first_name || 'Користувачу';
    
    if (isAdmin(ctx)) {
        const adminText = `Вітаю, Адміністраторе!\nПанель керування школою більярду активована.\n\nОберіть необхідну дію в меню нижче:`;
        return ctx.reply(adminText, getAdminKeyboard());
    }
    
    const userText = `Вітаємо, ${userName}!\nОфіційний бот школи більярду до ваших послуг.\n\nБудь ласка, оберіть потрібний розділ меню:`;
    return ctx.reply(userText, getUserKeyboard());
});


// ==========================================
//          РОЗДІЛИ КОРИСТУВАЧА
// ==========================================

// 1. Записатися на турнір
bot.hears('🎱 Записатися на турнір', (ctx) => {
    // Поки що це заглушка. Згодом ми будемо брати ці дані з бази
    const text = "🏆 <b>Найближчі турніри:</b>\n\n" +
                 "1. <i>Кубок Харкова (Вільна піраміда)</i>\n📅 15 червня, 18:00\n\n" +
                 "2. <i>Турнір для новачків (Пул 8)</i>\n📅 20 червня, 12:00\n\n" +
                 "Оберіть турнір, на який бажаєте зареєструватися:";
                 
    ctx.replyWithHTML(text, Markup.inlineKeyboard([
        [Markup.button.callback('Записатися на Кубок Харкова', 'reg_tour_1')],
        [Markup.button.callback('Записатися на Пул 8', 'reg_tour_2')]
    ]));
});

// Обробка натискання кнопок запису
bot.action(/reg_tour_(.+)/, async (ctx) => {
    await ctx.answerCbQuery('Ваша заявка обробляється...');
    await ctx.reply('Дякуємо! Ваша заявка на турнір прийнята. Адміністратор зв\'яжеться з вами для підтвердження.');
});

// 2. Зв'язок
bot.hears('📞 Зв\'язок', (ctx) => {
    const text = "📞 <b>Наші контакти:</b>\n\n" +
                 "Телефон: +38 (099) XXX-XX-XX\n" +
                 "Адреса: м. Харків, [вулиця]\n\n" +
                 "Ви також можете написати адміністратору безпосередньо через цього бота. Натисніть кнопку нижче:";
                 
    ctx.replyWithHTML(text, Markup.inlineKeyboard([
        [Markup.button.callback('✉️ Написати адміністратору', 'start_chat')]
    ]));
});

// Початок чату
bot.action('start_chat', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("✍️ Напишіть ваше повідомлення сюди, і ми передамо його адміністратору.\n\n(Для скасування операції натисніть /cancel)");
});


// ==========================================
//          АДМІН-ПАНЕЛЬ
// ==========================================

bot.hears('➕ Додати турнір', (ctx) => {
    if (!isAdmin(ctx)) return; // Захист від звичайних юзерів
    ctx.reply("Щоб додати новий турнір, надішліть його назву, дату, час та формат.\n\n(Ця функція запрацює після підключення бази даних)");
});

bot.hears('💬 Чат з користувачами', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply("Тут ви зможете бачити вхідні повідомлення від користувачів, відповідати їм, завершувати діалог або блокувати спамерів.\n\n(Очікує підключення системи чатів)");
});


// --- ЕКСПОРТ ДЛЯ VERCEL ---
module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Помилка:', error);
        res.status(500).send('Internal Server Error');
    }
};
