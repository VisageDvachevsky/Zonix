PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  master VARCHAR(128) DEFAULT NULL,
  last_check INTEGER DEFAULT NULL,
  type VARCHAR(8) NOT NULL,
  notified_serial INTEGER DEFAULT NULL,
  account VARCHAR(40) DEFAULT NULL,
  options VARCHAR(65535) DEFAULT NULL,
  catalog VARCHAR(255) DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS domains_name_index ON domains(name);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER DEFAULT NULL,
  name VARCHAR(255) DEFAULT NULL,
  type VARCHAR(10) DEFAULT NULL,
  content VARCHAR(65535) DEFAULT NULL,
  ttl INTEGER DEFAULT NULL,
  prio INTEGER DEFAULT NULL,
  disabled TINYINT(1) DEFAULT 0,
  ordername VARCHAR(255) DEFAULT NULL,
  auth TINYINT(1) DEFAULT 1,
  FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS records_domain_id_index ON records(domain_id);
CREATE INDEX IF NOT EXISTS records_name_index ON records(name);
CREATE INDEX IF NOT EXISTS records_ordername_index ON records(ordername);

CREATE TABLE IF NOT EXISTS supermasters (
  ip VARCHAR(64) NOT NULL,
  nameserver VARCHAR(255) NOT NULL,
  account VARCHAR(40) NOT NULL,
  PRIMARY KEY (ip, nameserver)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL,
  modified_at INTEGER NOT NULL,
  account VARCHAR(40) NOT NULL,
  comment VARCHAR(65535) NOT NULL,
  FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS comments_name_type_index ON comments(name, type);
CREATE INDEX IF NOT EXISTS comments_order_index ON comments(domain_id, modified_at);

CREATE TABLE IF NOT EXISTS domainmetadata (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  kind VARCHAR(32),
  content TEXT,
  FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS domainmetadata_idx ON domainmetadata(domain_id, kind);

CREATE TABLE IF NOT EXISTS cryptokeys (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  flags INT NOT NULL,
  active BOOL,
  published BOOL DEFAULT 1,
  content TEXT,
  FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS domainidindex ON cryptokeys(domain_id);

CREATE TABLE IF NOT EXISTS tsigkeys (
  id INTEGER PRIMARY KEY,
  name VARCHAR(255),
  algorithm VARCHAR(50),
  secret VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS tsigkeys_name_algo_index ON tsigkeys(name, algorithm);
