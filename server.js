const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const { Low, JSONFile } = require("lowdb");
const bcrypt = require("bcrypt");

const usersDB = new Low(new JSONFile("users.json"));
const messagesDB = new Low(new JSONFile("db.json"));

let onlineUsers = [];

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

            // Убираем старую сессию если есть (на случай переподключения)
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

            const msg = { user: socket.username, text, time: new Date().toLocaleTimeString() };
            messagesDB.data.private[room].push(msg);
            await messagesDB.write();

            const target = onlineUsers.find(u => u.username === to);
            if (target) {
                io.to(target.socketId).emit("private message", { from: socket.username, text: msg.text, time: msg.time });
            }
            socket.emit("private message", { from: socket.username, text: msg.text, time: msg.time });
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

        const handleDisconnect = () => {
            if (socket.username) {
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
