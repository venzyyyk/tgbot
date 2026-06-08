const { MongoClient, ObjectId } = require('mongodb');
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
        ['➕ Додати турнір', '❌ Видалити турнір']
    ]).resize();
};

bot.start(async (ctx) => {
    const userName = ctx.from.first_name || 'Користувачу';
    
    try {
        const db = await getDatabase();
        // Сбрасываем статусы чата при старте на всякий случай
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() }, $unset: { isChatting: "", replyingTo: "" } },
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
        const tournament = await db.collection('tournaments').findOne({ _id: new ObjectId(tournamentId) });

        if (!tournament || !tournament.formLink) {
            await ctx.answerCbQuery('Помилка: форму для цього турніру не знайдено.');
            return;
        }

        await db.collection('registrations').insertOne({
            tournamentId,
            userId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            date: new Date()
        });

        await ctx.answerCbQuery();
        const text = `📝 Щоб завершити реєстрацію на <b>${tournament.title}</b>, будь ласка, заповніть цю форму:\n\n👉 ${tournament.formLink}\n\nПісля заповнення ми зв'яжемося з вами для підтвердження.`;
        await ctx.replyWithHTML(text);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Сталася помилка.');
    }
});

bot.hears('📞 Зв\'язок', (ctx) => {
    const text = "📞 <b>Наші контакти:</b>\n\nТелефон: +38 (099) XXX-XX-XX\nАдреса: м. Харків\n\nВи також можете написати адміністратору безпосередньо через цього бота. Натисніть кнопку нижче:";
    ctx.replyWithHTML(text, Markup.inlineKeyboard([[Markup.button.callback('✉️ Написати адміністратору', 'start_chat')]]));
});

// --- ЛОГІКА ЧАТУ (ПОЧАТОК) ---

// 1. Користувач натискає кнопку
bot.action('start_chat', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isChatting: true } }
        );
        await ctx.reply("✍️ Напишіть ваше повідомлення. Воно буде надіслано адміністратору.");
    } catch (err) {
        console.error(err);
    }
});

// 2. Адмін натискає кнопку під повідомленням юзера
bot.action(/reply_(.+)/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Тільки для адміністраторів', { show_alert: true });
    
    const targetUserId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { replyingTo: targetUserId } }
        );
        await ctx.reply("✍️ Напишіть вашу відповідь. Наступне повідомлення буде надіслано цьому користувачу.");
    } catch (err) {
        console.error(err);
    }
});
// --- ЛОГІКА ЧАТУ (КІНЕЦЬ) ---


bot.hears('➕ Додати турнір', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply("Щоб додати новий турнір, надішліть повідомлення у такому форматі:\n\n+Турнір | Назва | Дата | Формат | Посилання на форму\n\nНаприклад:\n+Турнір | Кубок Харкова | 15 червня, 18:00 | Вільна піраміда | https://forms.gle/твоя_силка");
});

bot.hears(/^\+Турнір\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/i, async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const title = ctx.match[1].trim();
    const date = ctx.match[2].trim();
    const format = ctx.match[3].trim();
    const formLink = ctx.match[4].trim();

    try {
        const db = await getDatabase();
        await db.collection('tournaments').insertOne({
            title, date, format, formLink, active: true
        });
        ctx.reply(`✅ Турнір "${title}" успішно додано!\n🔗 Прив'язана форма: ${formLink}`);
    } catch (err) {
        ctx.reply("Помилка при додаванні турніру.");
    }
});

bot.hears('❌ Видалити турнір', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const db = await getDatabase();
        const tournaments = await db.collection('tournaments').find({ active: true }).toArray();

        if (tournaments.length ===
