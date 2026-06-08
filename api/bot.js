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
        ['➕ Додати турнір', '❌ Видалити турнір'],
        ['💬 Чат з користувачами']
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
            title,
            date,
            format,
            formLink,
            active: true
        });
        ctx.reply(`✅ Турнір "${title}" успішно додано!\n🔗 Прив'язана форма: ${formLink}`);
    } catch (err) {
        console.error(err);
        ctx.reply("Помилка при додаванні турніру до бази даних.");
    }
});

// --- НОВЕ: Вивід списку для видалення ---
bot.hears('❌ Видалити турнір', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const db = await getDatabase();
        const tournaments = await db.collection('tournaments').find({ active: true }).toArray();

        if (tournaments.length === 0) {
            return ctx.reply('Наразі немає активних турнірів для видалення.');
        }

        // Створюємо масив кнопок для кожного турніру
        const buttons = tournaments.map(t => [Markup.button.callback(`❌ ${t.title}`, `del_${t._id}`)]);
        
        return ctx.reply('Оберіть турнір, який хочете видалити:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        return ctx.reply('Помилка завантаження турнірів.');
    }
});

// --- НОВЕ: Логіка самого видалення з БД ---
bot.action(/del_(.+)/, async (ctx) => {
    if (!isAdmin(ctx)) {
        return ctx.answerCbQuery('У вас немає прав для цієї дії.', { show_alert: true });
    }
    
    const tournamentId = ctx.match[1];
    
    try {
        const db = await getDatabase();
        // Видаляємо документ з колекції по ID
        await db.collection('tournaments').deleteOne({ _id: new ObjectId(tournamentId) });
        
        await ctx.answerCbQuery('Турнір успішно видалено!');
        
        // Змінюємо повідомлення, щоб кнопки зникли
        await ctx.editMessageText('✅ Турнір успішно видалено з бази.');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Помилка видалення.');
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
