const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const port = 8080;

// Middleware
app.use(
  cors({
    origin: "*", // Allow all origins for demo purposes
  })
);
app.use(express.json());
app.use(express.static(__dirname + "/public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory storage for demo purposes
const clients = new Map(); // Map of clientId -> { ws, user }
const users = new Map(); // Map of userId -> user info
const chatRooms = new Map(); // Map of roomId -> { participants, messages }
const activeCalls = new Map(); // Map of callId -> call info

// Generate unique IDs
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Helper functions
function broadcastToRoom(roomId, message, excludeId = null) {
  const room = chatRooms.get(roomId);
  if (!room) return;

  room.participants.forEach((participantId) => {
    if (participantId !== excludeId) {
      const client = clients.get(participantId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  });
}

function broadcastToAll(message, excludeId = null) {
  for (const [clientId, client] of clients.entries()) {
    if (clientId !== excludeId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
}

function sendToUser(userId, message) {
  const client = clients.get(userId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  const clientId = generateId();
  let user = null;

  console.log(`New client connected: ${clientId}`);

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error("Invalid JSON:", error);
      return;
    }

    console.log(`Message from ${clientId}:`, message);

    switch (message.type) {
      case "USER_REGISTER":
        handleUserRegister(clientId, message, ws);
        break;
      case "USER_LOGIN":
        handleUserLogin(clientId, message, ws);
        break;
      case "GET_USERS":
        handleGetUsers(clientId);
        break;
      case "SEND_MESSAGE":
        handleSendMessage(clientId, message);
        break;
      case "JOIN_ROOM":
        handleJoinRoom(clientId, message);
        break;
      case "LEAVE_ROOM":
        handleLeaveRoom(clientId, message);
        break;
      case "INITIATE_CALL":
        handleInitiateCall(clientId, message);
        break;
      case "ANSWER_CALL":
        handleAnswerCall(clientId, message);
        break;
      case "REJECT_CALL":
        handleRejectCall(clientId, message);
        break;
      case "END_CALL":
        handleEndCall(clientId, message);
        break;
      case "WEBRTC_OFFER":
      case "WEBRTC_ANSWER":
      case "WEBRTC_ICE_CANDIDATE":
        handleWebRTCSignaling(clientId, message);
        break;
      case "TYPING_START":
      case "TYPING_STOP":
        handleTyping(clientId, message);
        break;
      case "USER_STATUS_CHANGE":
        handleUserStatusChange(clientId, message);
        break;
      default:
        console.log("Unknown message type:", message.type);
    }
  });

  ws.on("close", () => {
    handleDisconnect(clientId);
  });

  ws.on("error", (error) => {
    console.error(`Error on client ${clientId}:`, error);
  });

  // Send initial connection message
  ws.send(
    JSON.stringify({
      type: "CONNECTED",
      clientId: clientId,
      timestamp: new Date().toISOString(),
    })
  );
});

// Message handlers
function handleUserRegister(clientId, message, ws) {
  const { username, avatar } = message;

  // Check if username already exists
  for (const [id, userData] of users.entries()) {
    if (userData.username === username) {
      return ws.send(
        JSON.stringify({
          type: "ERROR",
          error: "USERNAME_EXISTS",
          message: `Username "${username}" already exists. Please choose a different username.`,
        })
      );
    }
  }

  const user = {
    id: clientId,
    username,
    avatar:
      avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
    status: "online",
    lastSeen: new Date().toISOString(),
  };

  users.set(clientId, user);
  clients.set(clientId, { ws, user });

  ws.send(
    JSON.stringify({
      type: "USER_REGISTERED",
      user,
    })
  );

  // Broadcast new user to all clients
  broadcastToAll(
    {
      type: "USER_JOINED",
      user,
    },
    clientId
  );
}

function handleUserLogin(clientId, message, ws) {
  const { username } = message;

  // Find existing user
  let existingUser = null;
  for (const [id, userData] of users.entries()) {
    if (userData.username === username) {
      existingUser = userData;
      users.delete(id); // Remove old entry
      break;
    }
  }

  if (!existingUser) {
    return ws.send(
      JSON.stringify({
        type: "ERROR",
        message: "User not found",
      })
    );
  }

  // Update user with new clientId
  existingUser.id = clientId;
  existingUser.status = "online";
  existingUser.lastSeen = new Date().toISOString();

  users.set(clientId, existingUser);
  clients.set(clientId, { ws, user: existingUser });

  ws.send(
    JSON.stringify({
      type: "USER_LOGGED_IN",
      user: existingUser,
    })
  );

  // Broadcast user came online
  broadcastToAll(
    {
      type: "USER_STATUS_UPDATE",
      userId: clientId,
      status: "online",
    },
    clientId
  );
}

function handleGetUsers(clientId) {
  const allUsers = Array.from(users.values()).filter((u) => u.id !== clientId);
  const client = clients.get(clientId);

  if (client) {
    client.ws.send(
      JSON.stringify({
        type: "USERS_LIST",
        users: allUsers,
      })
    );
  }
}

function handleSendMessage(clientId, message) {
  const { to, content, messageType = "text", roomId } = message;
  const client = clients.get(clientId);

  if (!client) return;

  const messageData = {
    id: generateId(),
    from: clientId,
    to,
    content,
    messageType,
    timestamp: new Date().toISOString(),
    roomId,
  };

  if (roomId) {
    // Room message
    const room = chatRooms.get(roomId);
    if (room) {
      room.messages.push(messageData);
      broadcastToRoom(roomId, {
        type: "NEW_MESSAGE",
        message: messageData,
      });
    }
  } else if (to) {
    // Direct message
    sendToUser(to, {
      type: "NEW_MESSAGE",
      message: messageData,
    });

    // Send confirmation to sender
    client.ws.send(
      JSON.stringify({
        type: "MESSAGE_SENT",
        message: messageData,
      })
    );
  }
}

function handleJoinRoom(clientId, message) {
  const { roomId, roomName } = message;

  if (!chatRooms.has(roomId)) {
    chatRooms.set(roomId, {
      id: roomId,
      name: roomName || `Room ${roomId}`,
      participants: [],
      messages: [],
      createdAt: new Date().toISOString(),
    });
  }

  const room = chatRooms.get(roomId);
  if (!room.participants.includes(clientId)) {
    room.participants.push(clientId);
  }

  const client = clients.get(clientId);
  if (client) {
    client.ws.send(
      JSON.stringify({
        type: "ROOM_JOINED",
        room: {
          ...room,
          messages: room.messages.slice(-50), // Send last 50 messages
        },
      })
    );
  }

  // Notify other participants
  broadcastToRoom(
    roomId,
    {
      type: "USER_JOINED_ROOM",
      userId: clientId,
      username: client?.user?.username,
    },
    clientId
  );
}

function handleLeaveRoom(clientId, message) {
  const { roomId } = message;
  const room = chatRooms.get(roomId);

  if (room) {
    room.participants = room.participants.filter((id) => id !== clientId);

    // Notify other participants
    broadcastToRoom(
      roomId,
      {
        type: "USER_LEFT_ROOM",
        userId: clientId,
      },
      clientId
    );
  }
}

function handleInitiateCall(clientId, message) {
  const { to, callType, roomId } = message; // callType: "audio" | "video" | "screen"
  const callId = generateId();

  const callData = {
    id: callId,
    initiator: clientId,
    participants: roomId
      ? chatRooms.get(roomId)?.participants || []
      : [clientId, to],
    callType,
    status: "ringing",
    startTime: new Date().toISOString(),
    roomId,
  };

  activeCalls.set(callId, callData);

  if (roomId) {
    // Conference call
    broadcastToRoom(
      roomId,
      {
        type: "INCOMING_CALL",
        call: callData,
      },
      clientId
    );
  } else {
    // Direct call
    sendToUser(to, {
      type: "INCOMING_CALL",
      call: callData,
    });
  }

  const client = clients.get(clientId);
  if (client) {
    client.ws.send(
      JSON.stringify({
        type: "CALL_INITIATED",
        call: callData,
      })
    );
  }
}

function handleAnswerCall(clientId, message) {
  const { callId } = message;
  const call = activeCalls.get(callId);

  if (call) {
    call.status = "active";
    call.answeredBy = clientId;
    call.answerTime = new Date().toISOString();

    // Notify all participants
    call.participants.forEach((participantId) => {
      sendToUser(participantId, {
        type: "CALL_ANSWERED",
        call,
      });
    });
  }
}

function handleRejectCall(clientId, message) {
  const { callId } = message;
  const call = activeCalls.get(callId);

  if (call) {
    call.status = "rejected";
    call.rejectedBy = clientId;
    call.endTime = new Date().toISOString();

    // Notify all participants
    call.participants.forEach((participantId) => {
      sendToUser(participantId, {
        type: "CALL_REJECTED",
        call,
      });
    });

    activeCalls.delete(callId);
  }
}

function handleEndCall(clientId, message) {
  const { callId } = message;
  const call = activeCalls.get(callId);

  if (call) {
    call.status = "ended";
    call.endTime = new Date().toISOString();
    call.endedBy = clientId;

    // Notify all participants
    call.participants.forEach((participantId) => {
      sendToUser(participantId, {
        type: "CALL_ENDED",
        call,
      });
    });

    activeCalls.delete(callId);
  }
}

function handleWebRTCSignaling(clientId, message) {
  const { to, callId } = message;

  if (to) {
    // Direct signaling
    sendToUser(to, {
      ...message,
      from: clientId,
    });
  } else if (callId) {
    // Conference signaling
    const call = activeCalls.get(callId);
    if (call) {
      call.participants.forEach((participantId) => {
        if (participantId !== clientId) {
          sendToUser(participantId, {
            ...message,
            from: clientId,
          });
        }
      });
    }
  }
}

function handleTyping(clientId, message) {
  const { to, roomId } = message;
  const client = clients.get(clientId);

  if (!client) return;

  const typingMessage = {
    ...message,
    from: clientId,
    username: client.user?.username,
  };

  if (roomId) {
    broadcastToRoom(roomId, typingMessage, clientId);
  } else if (to) {
    sendToUser(to, typingMessage);
  }
}

function handleUserStatusChange(clientId, message) {
  const { status } = message;
  const user = users.get(clientId);

  if (user) {
    user.status = status;
    user.lastSeen = new Date().toISOString();

    broadcastToAll(
      {
        type: "USER_STATUS_UPDATE",
        userId: clientId,
        status,
        lastSeen: user.lastSeen,
      },
      clientId
    );
  }
}

function handleDisconnect(clientId) {
  const client = clients.get(clientId);

  if (client && client.user) {
    // Update user status to offline
    client.user.status = "offline";
    client.user.lastSeen = new Date().toISOString();

    // Notify others about user going offline
    broadcastToAll(
      {
        type: "USER_STATUS_UPDATE",
        userId: clientId,
        status: "offline",
        lastSeen: client.user.lastSeen,
      },
      clientId
    );

    // End any active calls
    for (const [callId, call] of activeCalls.entries()) {
      if (call.participants.includes(clientId)) {
        handleEndCall(clientId, { callId });
      }
    }

    // Remove from chat rooms
    for (const [roomId, room] of chatRooms.entries()) {
      if (room.participants.includes(clientId)) {
        room.participants = room.participants.filter((id) => id !== clientId);
        broadcastToRoom(
          roomId,
          {
            type: "USER_LEFT_ROOM",
            userId: clientId,
          },
          clientId
        );
      }
    }
  }

  clients.delete(clientId);
  console.log(`Client disconnected: ${clientId}`);
}

// REST API endpoints
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    connections: clients.size,
    activeUsers: users.size,
    activeCalls: activeCalls.size,
    chatRooms: chatRooms.size,
  });
});

app.get("/api/users", (req, res) => {
  const allUsers = Array.from(users.values());
  res.json({ users: allUsers });
});

app.get("/api/rooms", (req, res) => {
  const rooms = Array.from(chatRooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    participantCount: room.participants.length,
    lastMessage: room.messages[room.messages.length - 1],
    createdAt: room.createdAt,
  }));
  res.json({ rooms });
});

server.listen(port, () => {
  console.log(`🚀 WebRTC Signaling Server running at http://localhost:${port}`);
  console.log(
    `📊 Health check available at http://localhost:${port}/api/health`
  );
  console.log(`👥 Users API available at http://localhost:${port}/api/users`);
  console.log(`🏠 Rooms API available at http://localhost:${port}/api/rooms`);
});
