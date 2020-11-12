DROP TABLE docs;
CREATE TABLE IF NOT EXISTS docs (path TEXT, author TEXT, timestam TEXT, sig TEXT, PRIMARY KEY(path, author));
INSERT INTO docs (path, timestam, sig, author) VALUES ("/b",  77, "#ddd", "@a");
INSERT INTO docs (path, timestam, sig, author) VALUES ("/b", 107, "#ccc", "@b");
INSERT INTO docs (path, timestam, sig, author) VALUES ("/b", 107, "#aaa-winner", "@z");  -- winner
INSERT INTO docs (path, timestam, sig, author) VALUES ("/b", 107, "#ggg", "@g");
INSERT INTO docs (path, timestam, sig, author) VALUES ("/a", 100, "#xxx", "@a");
INSERT INTO docs (path, timestam, sig, author) VALUES ("/a", 102, "#aaa-winner", "@b");  -- winner
INSERT INTO docs (path, timestam, sig, author) VALUES ("/c",   0, "#mmm-winner", "@b");  -- winner


SELECT path, author, timestam, sig, "" || (999-timestam) || "_" || sig
FROM docs
ORDER BY path ASC, timestam DESC, sig ASC


SELECT path, author, timestam, sig, MIN("" || (999-timestam) || "_" || sig) FROM docs
--WHERE path = "/b"
GROUP BY path
--HAVING author = "@b"
ORDER BY path ASC, author ASC
--LIMIT 2;

SELECT DISTINCT author FROM (
    SELECT author, MIN("" || (999-timestam) || "_" || sig) FROM docs
    --WHERE path = "/b"
    GROUP BY path
    --HAVING author = "@b"
    ORDER BY path ASC, author ASC
    --LIMIT 2;
)
ORDER BY author
