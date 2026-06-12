const { MongoClient, ObjectId } = require('mongodb');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN; // Твій токен від BotFather (LiqPay/Portmone тощо)

const bot = new Telegraf(BOT_TOKEN);
const ADMIN_IDS = [731859824, 6070383336, 8273747248]; 

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
        ['🖼 Афіша', ''],
        ['🌐 Приєднатися до VHC', '📞 Зв\'язок']
    ]).resize();
};

const getAdminKeyboard = () => {
    return Markup.keyboard([
        ['🏆 Записатися на турнір', '🎓 Записатися на навчання'],
        ['🖼 Афіша', ''],
        ['🌐 Приєднатися до VHC', '📞 Зв\'язок'],
        ['➕ Додати турнір', '❌ Видалити турнір'],
        ['➕ Додати афішу', '❌ Видалити афішу'],
        ['📢 Зробити розсилку']
    ]).resize();
};

bot.start(async (ctx) => {
    const userName = ctx.from.first_name || 'Користувачу';
    
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { 
                $set: { username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() }, 
                $unset: { isChatting: "", isTraining: "", replyingTo: "", isAnnouncing: "", isAddingPosterTitle: "", isAddingPosterPhotos: "", tempPosterTitle: "", tempPosterPhotos: "" } 
            },
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

// ==========================================
// --- 0. ПОДАРУНКОВІ СЕРТИФІКАТИ (ОПЛАТА) ---
// ==========================================

bot.hears('🎁 Сертифікати', (ctx) => {
    ctx.reply('🎁 <b>Подарункові сертифікати MATCHFLOW OS</b>\n\nЧудовий подарунок для любителів більярду! Сертифікат можна використати на тренування, оренду столу або участь у турнірі.\n\nОберіть номінал:', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('Сертифікат на 500 грн', 'buy_cert_500')],
                [Markup.button.callback('Сертифікат на 1000 грн', 'buy_cert_1000')],
                [Markup.button.callback('Сертифікат на 2000 грн', 'buy_cert_2000')]
            ]
        }
    });
});

bot.action(/buy_cert_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1]);
    
    if (!PAYMENT_TOKEN) {
        return ctx.answerCbQuery('Оплата наразі недоступна. Зверніться до адміністратора.', { show_alert: true });
    }

    const invoice = {
        title: `Сертифікат MATCHFLOW на ${amount} грн`,
        description: `Електронний подарунковий сертифікат номіналом ${amount} грн. Після оплати з вами зв'яжеться адміністратор для його оформлення.`,
        payload: `cert_${amount}_${ctx.from.id}_${Date.now()}`,
        provider_token: PAYMENT_TOKEN,
        currency: 'UAH',
        prices: [{ label: `Подарунковий сертифікат`, amount: amount * 100 }] // Телеграм приймає ціну в копійках, тому * 100
    };

    try {
        await ctx.replyWithInvoice(invoice);
        await ctx.answerCbQuery();
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Помилка при створенні рахунку.');
    }
});

// Обробник перевірки перед оплатою (обов'язковий для Телеграму)
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

// Обробник успішної оплати
bot.on('successful_payment', async (ctx) => {
    const paymentInfo = ctx.message.successful_payment;
    const amount = paymentInfo.total_amount / 100;
    const currency = paymentInfo.currency;

    // Повідомляємо клієнта
    await ctx.reply(`✅ <b>Оплата пройшла успішно!</b>\n\nВи придбали подарунковий сертифікат на суму <b>${amount} ${currency}</b>.\n\nНайближчим часом організатор зв'яжеться з вами для передачі сертифіката. Дякуємо!`, { parse_mode: 'HTML' });

    // Відправляємо сповіщення адмінам
    for (const adminId of ADMIN_IDS) {
        try {
            await ctx.telegram.sendMessage(
                adminId,
                `💰 <b>НОВА ОПЛАТА СЕРТИФІКАТА!</b> 💰\n\n👤 Користувач: ${ctx.from.first_name} (@${ctx.from.username || 'немає'})\n💳 Номінал: <b>${amount} ${currency}</b>\n🧾 ID транзакції: <code>${paymentInfo.provider_payment_charge_id}</code>\n\nЗв'яжіться з клієнтом для видачі сертифіката!`,
                { 
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[ Markup.button.callback('Написати клієнту', `reply_${ctx.from.id}`) ]]
                    }
                }
            );
        } catch (e) { console.error("Не зміг надіслати адміну", e); }
    }
});


// ==========================================
// --- 1. АФІША (АЛЬБОМИ З НАЗВОЮ ТА ГОРТАННЯМ) ---
// ==========================================

bot.hears('🖼 Афіша', async (ctx) => {
    try {
        const db = await getDatabase();
        const posters = await db.collection('posters').find().sort({ _id: -1 }).toArray();

        if (posters.length === 0) return ctx.reply('Наразі немає актуальних афіш.');

        const buttons = posters.map(p => [Markup.button.callback(`📌 ${p.title}`, `openposter_${p._id}`)]);
        return ctx.reply('🖼 <b>Доступні афіші:</b>\nОберіть подію зі списку нижче:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        ctx.reply('Помилка завантаження афіш.');
    }
});

bot.action('list_posters', async (ctx) => {
    try {
        await ctx.deleteMessage().catch(() => {});
        const db = await getDatabase();
        const posters = await db.collection('posters').find().sort({ _id: -1 }).toArray();
        if (posters.length === 0) return ctx.answerCbQuery('Афіші відсутні.');

        const buttons = posters.map(p => [Markup.button.callback(`📌 ${p.title}`, `openposter_${p._id}`)]);
        await ctx.reply('🖼 <b>Доступні афіші:</b>\nОберіть подію зі списку нижче:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
        await ctx.answerCbQuery();
    } catch (e) { console.error(e); }
});

bot.action(/openposter_(.+)/, async (ctx) => {
    const posterId = ctx.match[1];
    try {
        const db = await getDatabase();
        const poster = await db.collection('posters').findOne({ _id: new ObjectId(posterId) });
        if (!poster || !poster.photos || poster.photos.length === 0) return ctx.answerCbQuery('Афіша порожня.');

        await ctx.deleteMessage().catch(() => {});

        const buttons = [];
        if (poster.photos.length > 1) {
            buttons.push([
                Markup.button.callback('⬅️', `editposter_${poster._id}_${poster.photos.length - 1}`),
                Markup.button.callback(`1 / ${poster.photos.length}`, `ignore`),
                Markup.button.callback('➡️', `editposter_${poster._id}_1`)
            ]);
        }
        buttons.push([Markup.button.callback('🔙 Назад до списку', 'list_posters')]);

        await ctx.replyWithPhoto(poster.photos[0], {
            caption: `🖼 <b>${poster.title}</b>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
        await ctx.answerCbQuery();
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Помилка.');
    }
});

bot.action(/editposter_(.+)_(.+)/, async (ctx) => {
    const posterId = ctx.match[1];
    let idx = parseInt(ctx.match[2]);

    try {
        const db = await getDatabase();
        const poster = await db.collection('posters').findOne({ _id: new ObjectId(posterId) });
        if (!poster) return ctx.answerCbQuery('Афішу не знайдено.');

        let prevIdx = idx - 1 < 0 ? poster.photos.length - 1 : idx - 1;
        let nextIdx = idx + 1 >= poster.photos.length ? 0 : idx + 1;

        const buttons = [
            [
                Markup.button.callback('⬅️', `editposter_${poster._id}_${prevIdx}`),
                Markup.button.callback(`${idx + 1} / ${poster.photos.length}`, `ignore`),
                Markup.button.callback('➡️', `editposter_${poster._id}_${nextIdx}`)
            ],
            [Markup.button.callback('🔙 Назад до списку', 'list_posters')]
        ];

        await ctx.editMessageMedia(
            { type: 'photo', media: poster.photos[idx], caption: `🖼 <b>${poster.title}</b>`, parse_mode: 'HTML' },
            { reply_markup: { inline_keyboard: buttons } }
        ).catch(() => {});

        await ctx.answerCbQuery();
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Помилка.');
    }
});

bot.action('ignore', (ctx) => ctx.answerCbQuery());

bot.hears('➕ Додати афішу', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $set: { isAddingPosterTitle: true } }
        );
        ctx.reply("📝 Напишіть НАЗВУ для цієї афіші (наприклад: Тренувальний збір 15 липня):", {
            reply_markup: { keyboard: [['Скасувати ❌']], resize_keyboard: true }
        });
    } catch (err) { console.error(err); }
});

bot.hears('❌ Видалити афішу', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        const db = await getDatabase();
        const posters = await db.collection('posters').find().sort({ _id: -1 }).toArray();

        if (posters.length === 0) return ctx.reply('Наразі немає афіш для видалення.');

        const buttons = posters.map(p => [Markup.button.callback(`❌ ${p.title}`, `delpost_${p._id}`)]);
        return ctx.reply('Оберіть афішу, яку хочете видалити:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        return ctx.reply('Помилка завантаження афіш.');
    }
});

bot.action(/delpost_(.+)/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('У вас немає прав.', { show_alert: true });
    try {
        const db = await getDatabase();
        await db.collection('posters').deleteOne({ _id: new ObjectId(ctx.match[1]) });
        await ctx.answerCbQuery('Афішу успішно видалено!');
        await ctx.editMessageText('✅ Афішу успішно видалено з бази.');
    } catch (err) {
        await ctx.answerCbQuery('Помилка видалення.');
    }
});

// ==========================================
// --- ІНШІ ФУНКЦІЇ БОТА ---
// ==========================================

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

bot.hears('🌐 Приєднатися до VHC', (ctx) => {
    ctx.reply("🔗 <b>Система VHC (Venarion Handicap Control)</b>\n\nПриєднуйтесь до нашої системи, щоб відслідковувати свій прогрес, рейтинг та брати участь у турнірах MATCHFLOW OS.", {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[ Markup.button.url('Приєднатися на сайті', 'https://vhc.com.ua/login?next=%2Fprofile') ]]
        }
    });
});

bot.hears('📞 Зв\'язок', (ctx) => {
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

const cancelAction = async (ctx) => {
    try {
        const db = await getDatabase();
        await db.collection('users').updateOne(
            { telegramId: ctx.from.id },
            { $unset: { isChatting: "", isTraining: "", replyingTo: "", isAnnouncing: "", isAddingPosterTitle: "", isAddingPosterPhotos: "", tempPosterTitle: "", tempPosterPhotos: "" } }
        );
        const kb = isAdmin(ctx) ? getAdminKeyboard() : getUserKeyboard();
        await ctx.reply('Дію скасовано. Повернення до головного меню.', kb);
    } catch (err) {
        console.error(err);
    }
};

bot.hears('Скасувати ❌', cancelAction);
bot.command('cancel', cancelAction);

bot.on('message', async (ctx) => {
    const text = ctx.message.text || ctx.message.caption || '';
    const ignoreList = ['🏆 Записатися на турнір', '🎓 Записатися на навчання', '🖼 Афіша', '🎁 Сертифікати', '🌐 Приєднатися до VHC', '📞 Зв\'язок', '➕ Додати турнір', '❌ Видалити турнір', '➕ Додати афішу', '❌ Видалити афішу', '📢 Зробити розсилку', 'Скасувати ❌', '/start', '/cancel'];
    if (ignoreList.includes(text) || text.startsWith('+Турнір') || ctx.message.successful_payment) return;

    try {
        const db = await getDatabase();
        const user = await db.collection('users').findOne({ telegramId: ctx.from.id });

        if (isAdmin(ctx) && user?.isAddingPosterTitle) {
            if (!ctx.message.text) return ctx.reply('Будь ласка, надішліть текстом назву афіші.');
            await db.collection('users').updateOne(
                { telegramId: ctx.from.id },
                { 
                    $set: { isAddingPosterPhotos: true, tempPosterTitle: text, tempPosterPhotos: [] },
                    $unset: { isAddingPosterTitle: "" } 
                }
            );
            return ctx.reply(`✅ Назву "<b>${text}</b>" збережено.\n\n📸 Тепер відправте сюди фотографії. Ви можете виділити одразу декілька фото в галереї і надіслати їх одним повідомленням.\n\nКоли всі фото завантажаться — натисніть кнопку "💾 Зберегти афішу".`, {
                parse_mode: 'HTML',
                reply_markup: { keyboard: [['💾 Зберегти афішу'], ['Скасувати ❌']], resize_keyboard: true }
            });
        }

        if (isAdmin(ctx) && user?.isAddingPosterPhotos) {
            if (ctx.message.photo) {
                const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                await db.collection('users').updateOne(
                    { telegramId: ctx.from.id },
                    { $push: { tempPosterPhotos: fileId } }
                );
            } else if (text === '💾 Зберегти афішу') {
                if (!user.tempPosterPhotos || user.tempPosterPhotos.length === 0) {
                    return ctx.reply('❌ Ви не надіслали жодної фотографії! Надішліть фото, а потім тисніть зберегти.');
                }
                await db.collection('posters').insertOne({
                    title: user.tempPosterTitle,
                    photos: user.tempPosterPhotos,
                    date: new Date()
                });
                await db.collection('users').updateOne(
                    { telegramId: ctx.from.id },
                    { $unset: { isAddingPosterPhotos: "", tempPosterTitle: "", tempPosterPhotos: "" } }
                );
                return ctx.reply(`✅ Альбом "<b>${user.tempPosterTitle}</b>" (фото: ${user.tempPosterPhotos.length}) успішно збережено!`, {
                    parse_mode: 'HTML',
                    reply_markup: getAdminKeyboard()
                });
            }
            return;
        }

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
