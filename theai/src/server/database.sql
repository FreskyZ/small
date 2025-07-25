--------------------------------------
------ ATTENTION AUTO GENERATED ------
--------------------------------------

-- -- first, mysql -u root -p:
-- CREATE DATABASE 'YALA';
-- GRANT ALL PRIVILEGES ON `YALA`.* TO 'fine'@'localhost';
-- FLUSH PRIVILEGES;
-- -- then, mysql -p

CREATE TABLE `Session` (
    `SessionId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Comment` TEXT NULL,
    `Tags` VARCHAR(200) NOT NULL,
    `Shared` BIT NOT NULL,
    `ShareId` VARCHAR(36) NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Session` PRIMARY KEY (`SessionId`)
);
CREATE TABLE `Message` (
    `SessionId` INT NOT NULL,
    `MessageId` INT NOT NULL,
    `ParentMessageId` INT NULL,
    `Role` VARCHAR(32) NOT NULL,
    `Content` TEXT NOT NULL,
    `ThinkingContent` TEXT NULL,
    `PromptTokenCount` INT NULL,
    `CompletionTokenCount` INT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Message` PRIMARY KEY (`SessionId`,`MessageId`),
    CONSTRAINT `FK_Message_Session` FOREIGN KEY (`SessionId`) REFERENCES `Session`(`SessionId`)
);
CREATE TABLE `UserModel` (
    `UserId` INT NOT NULL AUTO_INCREMENT,
    `Name` VARCHAR(100) NOT NULL,
    `APIKey` VARCHAR(100) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_UserModel` PRIMARY KEY (`UserId`)
);
