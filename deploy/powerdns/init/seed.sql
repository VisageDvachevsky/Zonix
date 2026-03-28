DELETE FROM records;
DELETE FROM domains;

INSERT INTO domains (id, name, type) VALUES
  (1, 'example.com', 'MASTER'),
  (2, 'internal.example', 'MASTER');

INSERT INTO records (domain_id, name, type, content, ttl, prio, disabled, ordername, auth) VALUES
  (1, 'example.com', 'SOA', 'ns1.example.com. hostmaster.example.com. 2026032701 3600 600 1209600 300', 300, NULL, 0, NULL, 1),
  (1, 'example.com', 'NS', 'ns1.example.com.', 300, NULL, 0, NULL, 1),
  (1, 'ns1.example.com', 'A', '192.0.2.53', 300, NULL, 0, NULL, 1),
  (1, 'www.example.com', 'A', '192.0.2.10', 300, NULL, 0, NULL, 1),
  (1, 'api.example.com', 'A', '192.0.2.20', 300, NULL, 0, NULL, 1),
  (2, 'internal.example', 'SOA', 'ns1.internal.example. hostmaster.internal.example. 2026032701 3600 600 1209600 300', 300, NULL, 0, NULL, 1),
  (2, 'internal.example', 'NS', 'ns1.internal.example.', 300, NULL, 0, NULL, 1),
  (2, 'ns1.internal.example', 'A', '198.51.100.53', 300, NULL, 0, NULL, 1),
  (2, 'registry.internal.example', 'A', '198.51.100.25', 300, NULL, 0, NULL, 1),
  (2, 'txt.internal.example', 'TXT', '"zonix-day-10"', 300, NULL, 0, NULL, 1);
