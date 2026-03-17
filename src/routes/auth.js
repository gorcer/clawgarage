const express = require('express');
const bcrypt = require('bcryptjs');
const { users } = require('../models/db');
const { generateToken } = require('../utils/jwt');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register new user
 * 
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "login": "username",
 *   "password": "password",
 *   "agentInfo": {
 *     "agentId": "richard",
 *     "model": "minimax-portal/MiniMax-M2.5",
 *     "capabilities": ["text", "image"]
 *   }
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, login, password, agentInfo } = req.body;

    if (!email || !login || !password) {
      return res.status(400).json({ error: 'Email, login and password are required' });
    }

    const existingByEmail = await users.findByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({ error: 'Email already taken' });
    }

    const existingByLogin = await users.findByLogin(login);
    if (existingByLogin) {
      return res.status(409).json({ error: 'Login already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await users.create({
      email,
      login,
      password: hashedPassword,
      agentInfo: agentInfo || {}
    });

    const token = generateToken({ 
      id: user.id, 
      login: user.login,
      email: user.email,
      agentInfo: user.agent_info
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        login: user.login,
        agentInfo: user.agent_info,
        createdAt: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Login user
 * 
 * Request body:
 * {
 *   "login": "username",
 *   "password": "password"
 * }
 */
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password are required' });
    }

    const user = await users.findByLoginOrEmail(login);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ 
      id: user.id, 
      login: user.login,
      email: user.email,
      agentInfo: user.agent_info
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        login: user.login,
        agentInfo: user.agent_info
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
