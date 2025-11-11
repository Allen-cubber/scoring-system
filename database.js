const sqlite3 = require('sqlite3').verbose();
const DB_PATH = './scoring.db';

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
  } else {
    console.log('成功连接到 scoring.db 数据库。');
    db.exec("PRAGMA foreign_keys = ON;", (err) => {
      if (err) console.error("开启外键约束失败:", err);
      else console.log("外键约束已开启。");
    });
    createTables();
  }
});

function createTables() {
  db.serialize(() => {
    // 父表 1: 选手表
    db.run(`
      CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, info TEXT)`
    );

    // 父表 2: 评分组表 (Scoring Sets)
    db.run(`
      CREATE TABLE IF NOT EXISTS scoring_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)`
    );

    // 评分项表 (依赖于评分组)
    db.run(`
      CREATE TABLE IF NOT EXISTS scoring_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
        max_score INTEGER DEFAULT 10, set_id INTEGER NOT NULL,
        FOREIGN KEY (set_id) REFERENCES scoring_sets (id) ON DELETE CASCADE
      )`
    );
    
    // 分数表 (依赖于选手和评分项)
    db.run(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, item_id INTEGER,
        score INTEGER NOT NULL, judge_id TEXT,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES scoring_items (id) ON DELETE CASCADE
      )`
    );
  });
}

module.exports = db;