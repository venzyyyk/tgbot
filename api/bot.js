const { Telegraf } = require('telegraf');

// Токен лучше брать из переменных окружения (настроим позже в Vercel)
const BOT_TOKEN = process.env.BOT_TOKEN; 
const bot = new Telegraf(BOT_TOKEN);

// Твои команды
bot.start((ctx) => {
    ctx.reply('Привет! Я работаю через Webhook на Vercel!');
});

// Экспорт Serverless-функции для Vercel
module.exports = async (req, res) => {
    try {
        // Передаем тело запроса от Telegram в Telegraf
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).send('Internal Server Error');
    }
};