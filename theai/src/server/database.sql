--------------------------------------
------ ATTENTION AUTO GENERATED ------
--------------------------------------

-- -- first, mysql -u root -p:
-- CREATE DATABASE 'MyChat';
-- GRANT ALL PRIVILEGES ON `MyChat`.* TO 'fine'@'localhost';
-- FLUSH PRIVILEGES;
-- -- then, mysql -p

CREATE TABLE `Session` (
    `SessionId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Comment` TEXT NULL,
    `Tags` VARCHAR(200) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_Session` PRIMARY KEY (`SessionId`)
);
CREATE TABLE `Message` (
    `MessageId` INT NOT NULL AUTO_INCREMENT,
    `SessionId` INT NOT NULL,
    `ParentMessageId` INT NULL,
    `Role` VARCHAR(32) NOT NULL,
    `Content` TEXT NOT NULL,
    `PromptTokenCount` INT NULL,
    `CompletionTokenCount` INT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_Message` PRIMARY KEY (`MessageId`),
    CONSTRAINT `FK_Message_Session` FOREIGN KEY (`SessionId`) REFERENCES `Session`(`SessionId`)
);
CREATE TABLE `SharedSession` (
    `ShareId` VARCHAR(36) NOT NULL DEFAULT (UUID()),
    `SessionId` INT NOT NULL,
    `ExpireTime` DATETIME NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `PK_SharedSession` PRIMARY KEY (`ShareId`),
    CONSTRAINT `FK_SharedSession_Session` FOREIGN KEY (`SessionId`) REFERENCES `Session`(`SessionId`)
);
