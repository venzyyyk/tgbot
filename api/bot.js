const { MongoClient, ObjectId } = require('mongodb');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const bot = new Telegraf(BOT_TOKEN);
// ID адмінів (твої і Костянтина)
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
        ['🏆 Записатися на турнір', '🎓 Записатися на навчання'],
        ['🌐 Приєднатися до VHC', '📞 Зв\'язатися']
    ]).resize();
};

const getAdminKeyboard = () => {
    return Markup.keyboard([
        ['🏆 Записатися на турнір', '🎓 Записатися на навчання'],
        ['🌐 Приєднатися до VHC', '📞 Зв\'язатися'],
        ['➕ Додати турнір', '❌ Видалити турнір'],
        ['📢 Зробити розсилку']
    ]).resize();
};

bot.start(async (ctx) => {
    const userName = ctx.from.first_name || 'Користувачу';
    
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() }, $unset: { isChatting: "", replyingTo: "", isAnnouncing: "" } },
            { upsert: true }
        );
    } catch (err) {
        console.error(err);
    }

    if (isAdmin(ctx)) {
        return ctx.reply(`Вітаю, Адміністраторе системи MATCHFLOW OS!\nПанель керування активована.`, getAdminKeyboard());
    }
    
    return ctx.reply(`Вітаємо, ${userName}!\nВи в системі MATCHFLOW OS. Оберіть необхідну дію:`, getUserKeyboard());
});

// --- 1. ЗАПИС НА ТУРНІР ---
bot.hears('🏆 Записатися на турнір', async (ctx) => {
    try {
        const db = await getDatabase();
        const tournaments = await db.collection('tournaments').find({ active: true }).toArray();

        if (tournaments.length === 0) {
            return ctx.reply('Наразі немає активних турнірів для запису.');
        }

        let text = "🏆 <b>Найближчі турніри MATCHFLOW OS:</b>\n\n";
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
        const text = `📝 Щоб завершити реєстрацію на <b>${tournament.title}</b>, будь ласка, заповніть цю форму:\n\n👉 ${tournament.formLink}\n\nПісля заповнення ми зв'яжемося з вами.`;
        await ctx.replyWithHTML(text);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Сталася помилка.');
    }
});

// --- 2. ПРИЄДНАТИСЯ ДО VHC ---
bot.hears('🌐 Приєднатися до VHC', (ctx) => {
    ctx.reply("🔗 <b>Система VHC (Venarion Handicap Control)</b>\n\nПриєднуйтесь до нашої системи, щоб відслідковувати свій прогрес, рейтинг та брати участь у турнірах MATCHFLOW OS.", {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[ Markup.button.url('Приєднатися на сайті', 'https://vhc.com.ua/login?next=%2Fprofile') ]]
        }
    });
});

// --- 3. ЗВ'ЯЗОК ---
bot.hears('📞 Зв\'язатися', (ctx) => {
    ctx.reply("📞 <b>Зв'язок з організатором:</b>\n\nВи можете написати або зателефонувати безпосередньо Костянтину для вирішення будь-яких питань:\n\n👉 @cutting9", { parse_mode: 'HTML' });
});

// --- 4. ЗАПИС НА НАВЧАННЯ (ЧАТ З АДМІНОМ) ---
bot.hears('🎓 Записатися на навчання', async (ctx) => {
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isChatting: true } }
        );
        ctx.reply("✍️ Напишіть ваше ім'я, номер телефону та побажання щодо навчання. Ваша заявка буде надіслана тренеру.\n\n(Для скасування натисніть Скасувати ❌)", Markup.keyboard([['Скасувати ❌']]).resize());
    } catch (err) {
        console.error(err);
    }
});

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
        ctx.reply("✍️ Напишіть вашу відповідь. Наступне повідомлення буде надіслано цьому користувачу.", Markup.keyboard([['Скасувати ❌']]).resize());
    } catch (err) {
        console.error(err);
    }
});

// --- ТУРНІРИ (АДМІН) ---
bot.hears('➕ Додати турнір', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.reply("Щоб додати новий турнір, надішліть повідомлення у такому форматі:\n\n+Турнір | Назва | Дата | Формат | Посилання на форму\n\nНаприклад:\n+Турнір | VENOM OPEN XX | 15 червня, 18:00 | Вільна піраміда | https://forms.gle/твоя_силка");
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
