--------------------------------------
------ ATTENTION AUTO GENERATED ------
--------------------------------------

-- -- first, mysql -u root -p:
-- CREATE DATABASE 'YAMA';
-- GRANT ALL PRIVILEGES ON `YAMA`.* TO 'fine'@'localhost';
-- FLUSH PRIVILEGES;
-- -- then, mysql -p

CREATE TABLE `Book` (
    `BookId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Book` PRIMARY KEY (`BookId`)
);
CREATE TABLE `Section` (
    `SectionId` INT NOT NULL AUTO_INCREMENT,
    `BookId` INT NOT NULL,
    `ParentSectionId` INT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Section` PRIMARY KEY (`SectionId`),
    CONSTRAINT `FK_Section_Book` FOREIGN KEY (`BookId`) REFERENCES `Book`(`BookId`)
);
CREATE TABLE `Page` (
    `PageId` INT NOT NULL AUTO_INCREMENT,
    `BookId` INT NOT NULL,
    `SectionId` INT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Content` TEXT NOT NULL,
    `Shared` BIT NOT NULL,
    `ShareId` VARCHAR(36) NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Page` PRIMARY KEY (`PageId`),
    CONSTRAINT `FK_Page_Book` FOREIGN KEY (`BookId`) REFERENCES `Book`(`BookId`),
    CONSTRAINT `FK_Page_Section` FOREIGN KEY (`SectionId`) REFERENCES `Section`(`SectionId`)
);
CREATE TABLE `PageHistory` (
    `PageHistoryId` INT NOT NULL AUTO_INCREMENT,
    `PageId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_PageHistory` PRIMARY KEY (`PageHistoryId`),
    CONSTRAINT `FK_PageHistory_Page` FOREIGN KEY (`PageId`) REFERENCES `Page`(`PageId`)
);
CREATE TABLE `PageOperation` (
    `PageHistoryId` INT NOT NULL AUTO_INCREMENT,
    `Kind` VARCHAR(20) NOT NULL,
    `OriginalLine` INT NOT NULL,
    `NewLine` INT NOT NULL,
    `Content` TEXT NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_PageOperation` PRIMARY KEY (`PageHistoryId`),
    CONSTRAINT `FK_PageOperation_PageHistory` FOREIGN KEY (`PageHistoryId`) REFERENCES `PageHistory`(`PageHistoryId`)
);
CREATE TABLE `EmbeddedFiles` (
    `FileId` INT NOT NULL AUTO_INCREMENT,
    `PageId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Content` undefined NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_EmbeddedFiles` PRIMARY KEY (`FileId`)
);
