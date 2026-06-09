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
            { $set: { username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() }, $unset: { isChatting: "", isTraining: "", replyingTo: "", isAnnouncing: "" } },
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

// --- 3. ЗВ'ЯЗОК (ІНФО + ЧАТ) ---
bot.hears('📞 Зв\'язатися', (ctx) => {
    const text = "📞 <b>Зв'язок з організатором:</b>\n\n📱 Телефон: +380 68 990 64 34\n✈️ Telegram: @cutting9\n\nВи також можете написати повідомлення безпосередньо через цього бота. Натисніть кнопку нижче:";
    ctx.replyWithHTML(text, Markup.inlineKeyboard([[Markup.button.callback('✉️ Написати в бот', 'start_chat')]]));
});

bot.action('start_chat', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isChatting: true } }
        );
        ctx.reply("✍️ Напишіть ваше повідомлення. Воно буде надіслано організатору.\n\n(Для скасування натисніть Скасувати ❌)", Markup.keyboard([['Скасувати ❌']]).resize());
    } catch (err) {
        console.error(err);
    }
});

// --- 4. ЗАПИС НА НАВЧАННЯ ---
bot.hears('🎓 Записатися на навчання', async (ctx) => {
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isTraining: true } }
        );
        ctx.reply("✍️ Напишіть ваше ім'я та номер телефону. Ваша заявка буде надіслана тренеру.\n\n(Для скасування натисніть Скасувати ❌)", Markup.keyboard([['Скасувати ❌']]).resize());
    } catch (err) {
        console.error(err);
    }
});

// --- ВІДПОВІДЬ АДМІНА ---
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

        if (tournaments.length === 0) return ctx.reply('Наразі немає активних турнірів для видалення.');

        const buttons = tournaments.map(t => [Markup.button.callback(`❌ ${t.title}`, `del_${t._id}`)]);
        return ctx.reply('Оберіть турнір, який хочете видалити:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        return ctx.reply('Помилка завантаження турнірів.');
    }
});

bot.action(/del_(.+)/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('У вас немає прав.', { show_alert: true });
    const tournamentId = ctx.match[1];
    try {
        const db = await getDatabase();
        await db.collection('tournaments').deleteOne({ _id: new ObjectId(tournamentId) });
        await ctx.answerCbQuery('Турнір успішно видалено!');
        await ctx.editMessageText('✅ Турнір успішно видалено з бази.');
    } catch (err) {
        await ctx.answerCbQuery('Помилка видалення.');
    }
});

// --- РОЗСИЛКА (ОГОЛОШЕННЯ) ---
bot.hears('📢 Зробити розсилку', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isAnnouncing: true } }
        );
        ctx.reply("📣 <b>Режим розсилки активовано!</b>\n\nНадішліть сюди текст, фото або відео. Це повідомлення буде переслано <b>всім</b> користувачам бота.", {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [['Скасувати ❌']],
                resize_keyboard: true
            }
        });
    } catch (err) {
        console.error(err);
        ctx.reply('Помилка.');
    }
});

// --- СКАСУВАННЯ ДІЙ ---
const cancelAction = async (ctx) => {
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $unset: { isChatting: "", isTraining: "", replyingTo: "", isAnnouncing: "" } }
        );
        const kb = isAdmin(ctx) ? getAdminKeyboard() : getUserKeyboard();
        await ctx.reply('Дію скасовано. Повернення до головного меню.', kb);
    } catch (err) {
        console.error(err);
    }
};

bot.hears('Скасувати ❌', cancelAction);
bot.command('cancel', cancelAction);

// --- ОБРОБКА ВСІХ ПОВІДОМЛЕНЬ (ЧАТ + РОЗСИЛКА + НАВЧАННЯ) ---
bot.on('message', async (ctx) => {
    const text = ctx.message.text || ctx.message.caption || '';
    const ignoreList = ['🏆 Записатися на турнір', '🎓 Записатися на навчання', '🌐 Приєднатися до VHC', '📞 Зв\'язатися', '➕ Додати турнір', '❌ Видалити турнір', '📢 Зробити розсилку', 'Скасувати ❌', '/start', '/cancel'];
    if (ignoreList.includes(text) || text.startsWith('+Турнір')) return;

    try {
        const db = await getDatabase();
        const user = await db.collection('users').findOne({ telegramId: ctx.from.id });

        // 1. АДМІН робить РОЗСИЛКУ
        if (isAdmin(ctx) && user?.isAnnouncing) {
            const allUsers = await db.collection('users').find({}).toArray();
            let successCount = 0;
            
            await ctx.reply('⏳ Починаю розсилку, зачекайте...');
            
            for (const u of allUsers) {
                if (u.telegramId === ctx.from.id) continue;
                try {
                    await ctx.telegram.copyMessage(u.telegramId, ctx.from.id, ctx.message.message_id);
                    successCount++;
                } catch (e) {
                    console.log(`Не зміг відправити ${u.telegramId}`);
                }
            }
            
            await db.collection('users').updateOne({ telegramId: ctx.from.id }, { $unset: { isAnnouncing: "" } });
            await ctx.reply(`✅ Розсилку успішно надіслано ${successCount} користувачам!`, getAdminKeyboard());
            return;
        }

        // 2. АДМІН відповідає в чаті
        if (isAdmin(ctx) && user?.replyingTo) {
            const targetUserId = user.replyingTo;
            try {
                await ctx.telegram.sendMessage(targetUserId, `👨‍💼 <b>Відповідь від організатора:</b>`, { parse_mode: 'HTML' });
                await ctx.telegram.copyMessage(targetUserId, ctx.from.id, ctx.message.message_id);
                await ctx.reply('✅ Вашу відповідь успішно надіслано!', getAdminKeyboard());
            } catch (err) {
                await ctx.reply('❌ Помилка: користувач заблокував бота або його не знайдено.', getAdminKeyboard());
            }
            await db.collection('users').updateOne({ telegramId: ctx.from.id }, { $unset: { replyingTo: "" } });
            return;
        }

        // 3. ЮЗЕР (АБО АДМІН, ЩО ТЕСТУЄ) пише заявку на навчання АБО звичайне повідомлення
        if (user?.isChatting || user?.isTraining) {
            const isTraining = user.isTraining;
            const adminTitle = isTraining ? '📩 <b>Нова заявка на навчання:</b>' : '📩 <b>Нове повідомлення від користувача:</b>';
            const userReply = isTraining ? '✅ Ваша заявка передана тренеру! Очікуйте на відповідь.' : '✅ Ваше повідомлення передано організатору! Очікуйте на відповідь.';

            for (const adminId of ADMIN_IDS) {
                try {
                    await ctx.telegram.sendMessage(
                        adminId,
                        `${adminTitle}\n👤 ${ctx.from.first_name} (@${ctx.from.username || 'немає'})`,
                        { parse_mode: 'HTML' }
                    );
                    await ctx.telegram.copyMessage(adminId, ctx.from.id, ctx.message.message_id, {
                        reply_markup: {
                            inline_keyboard: [[ Markup.button.callback('Відповісти', `reply_${ctx.from.id}`) ]]
                        }
                    });
                } catch (e) { console.error("Не зміг надіслати адміну", e); }
            }
            
            await ctx.reply(userReply, isAdmin(ctx) ? getAdminKeyboard() : getUserKeyboard());
            await db.collection('users').updateOne({ telegramId: ctx.from.id }, { $unset: { isChatting: "", isTraining: "" } });
            return;
        }
    } catch (err) {
        console.error(err);
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
