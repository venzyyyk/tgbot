const { MongoClient } = require('mongodb');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const bot = new Telegraf(BOT_TOKEN);
const ADMIN_IDS = [731859824, 6070383336];

let cachedDb = null;

async function getDatabase() {
    if (cachedDb) return cachedDb;
    const client = await MongoClient.connect(MONGODB_URI);
    cachedDb = client.db('billiards_school');
    return cachedDb;
}

const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from.id);

const getUserKeyboard = () => {
    return Markup.keyboard([
        ['🎱 Записатися на турнір'],
        ['📞 Зв\'язок']
    ]).resize();
};

const getAdminKeyboard = () => {
    return Markup.keyboard([
        ['🎱 Записатися на турнір', '📞 Зв\'язок'],
        ['➕ Додати турнір', '💬 Чат з користувачами']
    ]).resize();
};

bot.start(async (ctx) => {
    const userName = ctx.from.first_name || 'Користувачу';
    
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() } },
            { upsert: true }
        );
    } catch (err) {
        console.error(err);
    }

    if (isAdmin(ctx)) {
        return ctx.reply(`Вітаю, Адміністраторе!\nПанель керування школою більярду активована.`, getAdminKeyboard());
    }
    
    return ctx.reply(`Вітаємо, ${userName}!\nОфіційний бот школи більярду до ваших послуг.`, getUserKeyboard());
});

bot.hears('🎱 Записатися на турнір', async (ctx) => {
    try {
        const db = await getDatabase();
        const tournaments = await db.collection('tournaments').find({ active: true }).toArray();

        if (tournaments.length === 0) {
            return ctx.reply('Наразі немає активних турнірів для запису.');
        }

        let text = "🏆 <b>Найближчі турніри:</b>\n\n";
        const buttons = [];

        tournaments.forEach((t) => {
            text += `🔹 <b>${t.title}</b>\n📅 Дата: ${t.date}\n📝 Формат: ${t.format}\n\n`;
            buttons.push([Markup.button.callback(`Записатися на ${t.title}`, `reg_${t._id}`)]);
        });

        text += "Оберіть турнір, на який бажаєте зареєструватися:";
        return ctx.replyWithHTML(text, Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        return ctx.reply('Помилка завантаження турнірів.');
    }
});

bot.action(/reg_(.+)/, async (ctx) => {
    const tournamentId = ctx.match[1];
    try {
        const db = await getDatabase();
        await db.collection('registrations').insertOne({
            tournamentId,
            userId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            date: new Date()
        });
        await ctx.answerCbQuery('Заявку прийнято!');
        await ctx.reply('Дякуємо! Ваша заявка на турнір прийнята. Адміністратор зв\'яжеться з вами для підтвердження.');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Помилка реєстрації.');
    }
});

bot.hears('📞 Зв\'язок', (ctx) => {
    const text = "📞 <b>Наші контакти:</b>\n\nТелефон: +38 (099) XXX-XX-XX\nАдреса: м. Харків\n\nВи також можете написати адміністратору безпосередньо через цього бота. Натисніть кнопку нижче:";
    ctx.replyWithHTML(text, Markup.inlineKeyboard([[Markup.button.callback('✉️ Написати адміністратору', 'start_chat')]]));
});

bot.action('start_chat', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("✍️ Напишіть ваше повідомлення сюди, і ми передамо його адміністратору.\n\n(Для скасування операції натисніть /cancel)");
});

bot.hears('💬 Чат з користувачами', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply("Система чатів у процесі розробки.");
});

bot.hears('➕ Додати турнір', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply("Щоб додати новий турнір, просто надішліть повідомлення у такому форматі:\n\n+Турнір | Назва | Дата | Формат\n\nНаприклад:\n+Турнір | Кубок Харкова | 15 червня, 18:00 | Вільна піраміда");
});

bot.hears(/^\+Турнір\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/i, async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const title = ctx.match[1].trim();
    const date = ctx.match[2].trim();
    const format = ctx.match[3].trim();

    try {
        const db = await getDatabase();
        await db.collection('tournaments').insertOne({
            title,
            date,
            format,
            active: true
        });
        ctx.reply(`✅ Турнір "${title}" успішно додано! Можете перевірити його в меню.`);
    } catch (err) {
        console.error(err);
        ctx.reply("Помилка при додаванні турніру до бази даних.");
    }
});

module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
};
