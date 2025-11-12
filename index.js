// 1. 引入所有必要的模块
const path = require('path');
const express = require('express');
const cors = require('cors'); // 引入 cors
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const db = require('./database.js');
const xlsx = require('xlsx');

// 2. 全局状态变量
let currentScoringPlayerId = null;

// 3. 初始化 Express 应用
const app = express();
const PORT = 3000;

// 4. 【核心修复】配置并使用中间件
// 确保 cors() 在所有路由之前被调用，这是解决 DELETE/PUT 问题的关键！
app.use(cors()); 

// 解析 JSON 格式的请求体
app.use(express.json()); 

// --- 【新增代码块 1】---
// 托管前端静态文件。这行代码告诉 Express，
// dist 文件夹是公开的，里面的文件可以直接通过 URL 访问。
app.use(express.static(path.join(__dirname, 'dist')));

// 配置 multer 用于文件上传
const upload = multer({ dest: 'uploads/' });

/*
================================================
 API: 评分组管理 (Scoring Sets)
================================================
*/

// 获取所有评分组
app.get('/api/scoring-sets', (req, res) => {
  db.all("SELECT * FROM scoring_sets", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "success", data: rows });
  });
});

// 添加新评分组
app.post('/api/scoring-sets', (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "必须提供有效的组名" });
  }
  db.run(`INSERT INTO scoring_sets (name) VALUES (?)`, [name], function(err) {
    if (err) return res.status(500).json({ error: "添加失败，可能是名称重复" });
    res.status(201).json({ message: "success", data: { id: this.lastID, name } });
  });
});

// 删除评分组 (及其下的所有评分项)
app.delete('/api/scoring-sets/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM scoring_sets WHERE id = ?', id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "未找到该评分组" });
    res.json({ message: "deleted", changes: this.changes });
  });
});

// 【新增】API: 批量导入评分组和评分项
app.post('/api/scoring-sets/import', upload.single('scoringFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }

  const filePath = req.file.path;
  let importedRows = [];

  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // 将Excel转换为JSON，指定表头映射
    importedRows = xlsx.utils.sheet_to_json(sheet, { 
      header: ['setName', 'itemName', 'description', 'maxScore'] 
    });

  } catch (error) {
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: '解析Excel文件失败' });
  }

  // 核心逻辑：处理数据并存入数据库
  try {
    // 使用一个Map来缓存已经找到或创建的评分组ID，避免重复查询数据库
    const groupCache = new Map();

    // 封装一个函数，用于获取或创建评分组ID
    const getOrCreateSetId = (name) => {
      return new Promise((resolve, reject) => {
        if (groupCache.has(name)) {
          return resolve(groupCache.get(name));
        }
        // 1. 先尝试查找
        db.get('SELECT id FROM scoring_sets WHERE name = ?', [name], function(err, row) {
          if (err) return reject(err);
          if (row) { // 找到了
            groupCache.set(name, row.id);
            resolve(row.id);
          } else { // 没找到，创建新的
            db.run('INSERT INTO scoring_sets (name) VALUES (?)', [name], function(err) {
              if (err) return reject(err);
              const newId = this.lastID;
              groupCache.set(name, newId);
              resolve(newId);
            });
          }
        });
      });
    };

    // 开启事务
    db.run("BEGIN TRANSACTION;");

    // 遍历所有行
    for (const row of importedRows) {
      if (row.setName && row.itemName && row.maxScore) {
        // 获取或创建评分组ID
        const setId = await getOrCreateSetId(row.setName);
        
        // 插入评分项
        const itemSql = `INSERT INTO scoring_items (name, description, max_score, set_id) VALUES (?, ?, ?, ?)`;
        // 使用 db.run 的回调来捕获可能的错误
        await new Promise((resolve, reject) => {
          db.run(itemSql, [row.itemName, row.description || '', row.maxScore, setId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    }

    // 提交事务
    db.run("COMMIT;");

    fs.unlinkSync(filePath);
    res.status(201).json({ message: `导入成功，共处理 ${importedRows.length} 行数据。`, count: importedRows.length });

  } catch (error) {
    db.run("ROLLBACK;"); // 如果任何一步出错，回滚所有操作
    fs.unlinkSync(filePath);
    console.error("导入评分项数据库操作失败:", error);
    res.status(500).json({ error: '数据库操作失败，请检查文件内容是否合规。' });
  }
});

/*
================================================
 API: 评分项管理 (Scoring Items) - 已升级
================================================
*/

// 获取某个评分组下的所有评分项
app.get('/api/scoring-sets/:setId/items', (req, res) => {
  const { setId } = req.params;
  db.all("SELECT * FROM scoring_items WHERE set_id = ?", [setId], (err, rows) => {
    if (err) return res.status(500).json({ "error": err.message });
    res.json({ "message": "success", "data": rows });
  });
});

// 在某个评分组下添加新评分项
app.post('/api/scoring-sets/:setId/items', (req, res) => {
  const { setId } = req.params;
  const { name, description, max_score } = req.body;
  if (!name || !max_score) {
    return res.status(400).json({ "error": "必须提供评分项名称和满分" });
  }
  const sql = `INSERT INTO scoring_items (name, description, max_score, set_id) VALUES (?, ?, ?, ?)`;
  db.run(sql, [name, description, max_score, setId], function(err) {
    if (err) return res.status(500).json({ "error": err.message });
    res.status(201).json({ "message": "success", "data": { id: this.lastID, set_id: parseInt(setId), ...req.body }});
  });
});

// 编辑一个评分项 (这个 API 保持不变，因为 item.id 是全局唯一的)
app.put('/api/scoring-items/:id', (req, res) => {
  const { name, description, max_score } = req.body;
  const sql = `UPDATE scoring_items SET name = ?, description = ?, max_score = ? WHERE id = ?`;
  db.run(sql, [name, description, max_score, req.params.id], function(err) {
    if (err) return res.status(500).json({ "error": err.message });
    res.json({ message: "success", changes: this.changes });
  });
});

// 删除一个评分项
app.delete('/api/scoring-items/:id', (req, res) => {
  const id = req.params.id;
  const sql = 'DELETE FROM scoring_items WHERE id = ?';
  
  db.run(sql, [id], function(err) { // 【检查点1】确保 id 被放在一个数组里 [id]
    if (err) {
      console.error(`删除评分项失败 (ID: ${id}):`, err.message);
      return res.status(500).json({ "error": "数据库操作失败", "details": err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ "error": `未找到 ID 为 ${id} 的评分项` });
    }
    res.json({ "message": "deleted", changes: this.changes });
  });
});


/*
================================================
 API: 选手管理 (Players)
================================================
*/

// 【新增】API: 手动录入单个选手
app.post('/api/players', (req, res) => {
  const { name, info } = req.body;

  // 后端数据验证
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "选手姓名不能为空" });
  }

  const sql = 'INSERT INTO players (name, info) VALUES (?, ?)';
  // 如果 info 未提供，则存入空字符串
  const params = [name, info || '']; 

  db.run(sql, params, function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: "数据库操作失败" });
    }
    // 成功后，返回新创建的选手数据，包括ID
    res.status(201).json({
      message: "success",
      data: {
        id: this.lastID,
        name: name,
        info: info || ''
      }
    });
  });
});

// 批量导入选手 (上传Excel文件) - 升级版
app.post('/api/players/import', upload.single('playersFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }

  const filePath = req.file.path;
  let players = [];

  try {
    // 1. 使用 xlsx 库读取上传的文件
    const workbook = xlsx.readFile(filePath);
    
    // 2. 获取第一个工作表 (Sheet) 的名称
    const sheetName = workbook.SheetNames[0];
    
    // 3. 获取该工作表
    const sheet = workbook.Sheets[sheetName];
    
    // 4. 将工作表内容转换为 JSON 数组
    //    我们假设 Excel 文件没有表头，A列是姓名，B列是简介
    players = xlsx.utils.sheet_to_json(sheet, { header: ['name', 'info'] });

  } catch (error) {
    console.error("解析Excel文件失败:", error);
    // 删除临时文件
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: '解析Excel文件失败，请确保文件格式正确。' });
  }

  // 5. 将解析出的数据存入数据库 (这部分逻辑和之前一样)
  const sql = `INSERT INTO players (name, info) VALUES (?, ?)`;
  db.serialize(() => {
    db.run("BEGIN TRANSACTION;");
    players.forEach(player => {
      // 确保 name 字段存在且不为空
      if (player.name && player.name.toString().trim() !== '') {
        db.run(sql, [player.name, player.info || '']); // 如果info不存在，则存入空字符串
      }
    });
    db.run("COMMIT;");
  });

  // 6. 删除临时的上传文件
  fs.unlinkSync(filePath);

  res.status(201).json({ 
    message: '选手导入成功',
    count: players.length 
  });
});

// 获取所有选手列表
app.get('/api/players', (req, res) => {
  db.all("SELECT * FROM players ORDER BY id ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ "error": err.message });
    }
    res.json({ "message": "success", "data": rows });
  });
});

// 编辑一个选手信息
app.put('/api/players/:id', (req, res) => {
    const { name, info } = req.body;
    const id = req.params.id;
    db.run(`UPDATE players SET name = ?, info = ? WHERE id = ?`, [name, info, id], function(err) {
        if (err) {
            return res.status(500).json({ "error": err.message });
        }
        res.json({ "message": "success", changes: this.changes });
    });
});

// 删除一个选手
app.delete('/api/players/:id', (req, res) => {
    const id = req.params.id;
    const sql = 'DELETE FROM players WHERE id = ?';

    db.run(sql, [id], function(err) { // 【检查点1】确保 id 被放在一个数组里 [id]
        if (err) {
            console.error(`删除选手失败 (ID: ${id}):`, err.message);
            return res.status(500).json({ "error": "数据库操作失败", "details": err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ "error": `未找到 ID 为 ${id} 的选手` });
        }
        res.json({ "message": "deleted", changes: this.changes });
    });
});


/*
================================================
 API: 实时评分控制与提交 (Live Control & Scoring) - 已升级
================================================
*/

// 【新增】设置当前比赛使用的评分组
app.post('/api/live/set-active/:setId', (req, res) => {
  activeScoringSetId = req.params.setId;
  console.log(`激活的评分组已切换为: ${activeScoringSetId}`);
  res.json({ message: `评分组 ${activeScoringSetId} 已激活` });
});

// 【后台用】开始为某个选手评分
app.post('/api/live/start/:playerId', (req, res) => {
  if (!activeScoringSetId) {
    return res.status(400).json({ error: "在开始评分前，必须先设置一个激活的评分组" });
  }
  currentScoringPlayerId = req.params.playerId;
  console.log(`评分开始，当前选手 ID: ${currentScoringPlayerId}，使用评分组 ID: ${activeScoringSetId}`);
  res.json({ message: `已开启为选手 ${req.params.playerId} 的评分通道` });
});

// 【后台用】停止所有评分
app.post('/api/live/stop', (req, res) => {
  currentScoringPlayerId = null;
  console.log('所有评分已停止');
  res.json({ message: '已关闭所有评分通道' });
});

// 【评委端用】获取当前应评分的选手信息 - 【修改】
app.get('/api/live/current', (req, res) => {
  if (!currentScoringPlayerId || !activeScoringSetId) {
    return res.json({ player: null, scoringItems: [] });
  }
  const playerSql = "SELECT * FROM players WHERE id = ?";
  const itemsSql = "SELECT * FROM scoring_items WHERE set_id = ?"; // 查询语句已修改
  
  db.get(playerSql, [currentScoringPlayerId], (err, player) => {
    if (err) return res.status(500).json({ "error": err.message });
    if (!player) return res.status(404).json({ "error": "找不到该选手" });

    db.all(itemsSql, [activeScoringSetId], (err, items) => { // 使用 activeScoringSetId 进行查询
      if (err) return res.status(500).json({ "error": err.message });
      res.json({ player: player, scoringItems: items });
    });
  });
});

// 【评委端用】提交评分 - 终极版，支持修改自己的评分 (Upsert)
app.post('/api/scores', (req, res) => {
  const { playerId, scores, judgeId } = req.body;

  // 1. 基础数据验证 (保持不变)
  if (!playerId || !scores || !Array.isArray(scores) || scores.length === 0 || !judgeId) {
    return res.status(400).json({ error: '请求数据格式不正确' });
  }

  // 2. 检查评分通道是否开启 (保持不变)
  if (playerId.toString() !== currentScoringPlayerId) {
      return res.status(403).json({ error: '该选手当前的评分通道已关闭' });
  }

  // 3. 【核心改动】使用事务执行“先删除后插入”的 Upsert 操作
  const deleteSql = 'DELETE FROM scores WHERE player_id = ? AND judge_id = ?';
  const insertSql = `INSERT INTO scores (player_id, item_id, score, judge_id) VALUES (?, ?, ?, ?)`;

  // db.serialize 确保所有操作按顺序执行
  db.serialize(() => {
    // 开启事务
    db.run("BEGIN TRANSACTION;");

    // 第一步：不管之前有没有，都先尝试删除该评委对该选手的所有旧分数
    db.run(deleteSql, [playerId, judgeId]);

    // 第二步：循环插入本次提交的新分数
    scores.forEach(item => {
      db.run(insertSql, [playerId, item.itemId, item.score, judgeId]);
    });

    // 第三步：提交事务
    db.run("COMMIT;", (err) => {
      if (err) {
        // 如果提交事务时出错，回滚
        db.run("ROLLBACK;");
        console.error("提交分数事务失败:", err.message);
        return res.status(500).json({ error: "评分提交失败，请重试" });
      }
      
      // 事务成功提交
      res.status(201).json({ message: '评分提交/更新成功！' });
    });
  });
});

/*
================================================
 API: 数据统计与排名 (Results & Ranking)
================================================
*/

app.get('/api/results', (req, res) => {
  const sql = `
    SELECT
      p.id, p.name, p.info,
      COUNT(DISTINCT s.judge_id) as judge_count,
      IFNULL(SUM(s.score), 0) as total_score
    FROM players p
    LEFT JOIN scores s ON p.id = s.player_id
    GROUP BY p.id, p.name, p.info
    ORDER BY total_score DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ "error": err.message });
    }
    const results = rows.map(player => ({
      ...player,
      final_average_score: player.judge_count > 0 ? (player.total_score / player.judge_count).toFixed(2) : 0
    }));
    res.json({ message: "success", data: results });
  });
});

// 【新增】API: 重置/删除某位选手的所有评分数据
app.delete('/api/results/reset/:playerId', (req, res) => {
  const { playerId } = req.params;

  if (!playerId) {
    return res.status(400).json({ error: "必须提供选手ID" });
  }

  const sql = 'DELETE FROM scores WHERE player_id = ?';

  db.run(sql, [playerId], function(err) {
    if (err) {
      // 这一行会在你的后端控制台打印出详细错误
      console.error("重置评分失败:", err.message); 
      return res.status(500).json({ error: "数据库操作失败" });
    }

    if (this.changes === 0) {
      console.log(`尝试重置选手 ${playerId} 的分数，但该选手尚无评分记录。`);
    } else {
      console.log(`已成功重置选手 ${playerId} 的 ${this.changes} 条评分记录。`);
    }
    
    res.json({ 
      message: "重置成功", 
      deleted_count: this.changes 
    });
  });
});

// SPA "兜底" 路由 - 修正后的兼容性写法
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 6. 启动服务器
app.listen(PORT, () => {
  console.log(`服务器已启动，正在监听 http://localhost:${PORT}`);
});