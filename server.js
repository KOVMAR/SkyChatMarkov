const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const { Low, JSONFile } = require("lowdb");
const bcrypt = require("bcrypt");

const usersDB = new Low(new JSONFile("users.json"));
const messagesDB = new Low(new JSONFile("db.json"));

let onlineUsers = [];

// activeChats[username] = withWhom (кто сейчас открыт у пользователя)
const activeChats = {};

// typingTimers[socketId] = timer
const typingTimers = {};

app.use(express.static("public"));

async function init() {
    await usersDB.read();
    usersDB.data ||= { users: [] };
    await usersDB.write();

    await messagesDB.read();
    messagesDB.data ||= { messages: [], private: {} };
    await messagesDB.write();

    io.on("connection", (socket) => {

        // Регистрация
        socket.on("register", async ({ username, password }) => {
            await usersDB.read();
            if (usersDB.data.users.find(u => u.username === username)) {
                return socket.emit("register result", { success: false, msg: "Имя уже занято" });
            }
            const hash = await bcrypt.hash(password, 10);
            usersDB.data.users.push({ username, password: hash });
            await usersDB.write();
            socket.emit("register result", { success: true });
        });

        // Логин
        socket.on("login", async ({ username, password }) => {
            await usersDB.read();
            const user = usersDB.data.users.find(u => u.username === username);
            if (!user) {
                return socket.emit("login result", { success: false, msg: "Пользователь не найден" });
            }
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return socket.emit("login result", { success: false, msg: "Неверный пароль" });
            }

            socket.username = username;

            onlineUsers = onlineUsers.filter(u => u.username !== username);
            onlineUsers.push({ username, socketId: socket.id });

            io.emit("update users", onlineUsers.map(u => u.username));

            await messagesDB.read();
            socket.emit("chat history", messagesDB.data.messages || []);
            socket.emit("login result", { success: true, username });

            io.emit("chat message", {
                user: "Система",
                text: `${username} подключился`,
                time: new Date().toLocaleTimeString()
            });
        });

        // Публичные сообщения
        socket.on("chat message", async ({ text }) => {
            if (!socket.username) return;
            await messagesDB.read();
            messagesDB.data.messages ||= [];
            const msg = { user: socket.username, text, time: new Date().toLocaleTimeString() };
            messagesDB.data.messages.push(msg);
            await messagesDB.write();
            io.emit("chat message", msg);
        });

        // Приватные сообщения
        socket.on("private message", async ({ to, text }) => {
            if (!socket.username) return;
            const users = [socket.username, to].sort();
            const room = users.join("_");

            await messagesDB.read();
            messagesDB.data.private ||= {};
            if (!messagesDB.data.private[room]) messagesDB.data.private[room] = [];

            // Генерируем уникальный id сообщения
            const msgId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

            // Проверяем, открыт ли у получателя чат именно с отправителем
            const recipientActiveChat = activeChats[to];
            const isRead = (recipientActiveChat === socket.username);

            const msg = {
                id: msgId,
                user: socket.username,
                text,
                time: new Date().toLocaleTimeString(),
                read: isRead
            };
            messagesDB.data.private[room].push(msg);
            await messagesDB.write();

            const target = onlineUsers.find(u => u.username === to);
            if (target) {
                io.to(target.socketId).emit("private message", {
                    id: msg.id,
                    from: socket.username,
                    text: msg.text,
                    time: msg.time,
                    read: msg.read
                });
            }
            // Отправителю — тоже с id и статусом
            socket.emit("private message", {
                id: msg.id,
                from: socket.username,
                text: msg.text,
                time: msg.time,
                read: msg.read
            });
        });

        // История приватного чата
        socket.on("get private history", async ({ withUser }) => {
            if (!socket.username) return;
            const users = [socket.username, withUser].sort();
            const room = users.join("_");
            await messagesDB.read();
            const history = messagesDB.data.private?.[room] || [];
            socket.emit("private history", { withUser, history });
        });

        // Пользователь открыл приватный чат — сообщаем серверу
        socket.on("open private chat", async ({ withUser }) => {
            if (!socket.username) return;
            activeChats[socket.username] = withUser;

            // Помечаем все непрочитанные сообщения от withUser как прочитанные
            const users = [socket.username, withUser].sort();
            const room = users.join("_");

            await messagesDB.read();
            if (!messagesDB.data.private?.[room]) return;

            let changed = false;
            const updatedIds = [];
            messagesDB.data.private[room].forEach(m => {
                if (m.user === withUser && !m.read) {
                    m.read = true;
                    updatedIds.push(m.id);
                    changed = true;
                }
            });
            if (changed) await messagesDB.write();

            // Уведомляем отправителя (withUser), что его сообщения прочитаны
            if (updatedIds.length > 0) {
                const sender = onlineUsers.find(u => u.username === withUser);
                if (sender) {
                    io.to(sender.socketId).emit("messages read", {
                        byUser: socket.username,
                        ids: updatedIds
                    });
                }
            }
        });

        // Пользователь закрыл приватный чат / перешёл в другой
        socket.on("close private chat", () => {
            if (socket.username) delete activeChats[socket.username];
        });

        // ─── Typing ───
        socket.on("typing start", ({ to }) => {
            if (!socket.username) return;
            const target = onlineUsers.find(u => u.username === to);
            if (target) {
                io.to(target.socketId).emit("typing", { from: socket.username });
            }
            // Автоматически сбрасываем через 3с если "typing stop" не пришёл
            if (typingTimers[socket.id]) clearTimeout(typingTimers[socket.id]);
            typingTimers[socket.id] = setTimeout(() => {
                if (target) io.to(target.socketId).emit("typing stop", { from: socket.username });
            }, 3000);
        });

        socket.on("typing stop", ({ to }) => {
            if (!socket.username) return;
            const target = onlineUsers.find(u => u.username === to);
            if (target) io.to(target.socketId).emit("typing stop", { from: socket.username });
            if (typingTimers[socket.id]) {
                clearTimeout(typingTimers[socket.id]);
                delete typingTimers[socket.id];
            }
        });

        const handleDisconnect = () => {
            if (socket.username) {
                delete activeChats[socket.username];
                if (typingTimers[socket.id]) {
                    clearTimeout(typingTimers[socket.id]);
                    delete typingTimers[socket.id];
                }
                onlineUsers = onlineUsers.filter(u => u.socketId !== socket.id);
                io.emit("update users", onlineUsers.map(u => u.username));
                io.emit("chat message", {
                    user: "Система",
                    text: `${socket.username} вышел`,
                    time: new Date().toLocaleTimeString()
                });
            }
        };

        socket.on("logout", handleDisconnect);
        socket.on("disconnect", handleDisconnect);
    });

    http.listen(3000, () => {
        console.log("Сервер запущен на http://localhost:3000");
    });
}

init().catch(console.error);
