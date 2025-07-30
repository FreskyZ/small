--------------------------------------
------ ATTENTION AUTO GENERATED ------
--------------------------------------

-- -- first, mysql -u root -p:
-- CREATE DATABASE `YAMA`;
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
    `PageOperationId` INT NOT NULL AUTO_INCREMENT,
    `PageHistoryId` INT NOT NULL,
    `Kind` VARCHAR(20) NOT NULL,
    `Line` INT NOT NULL,
    `Content` TEXT NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_PageOperation` PRIMARY KEY (`PageOperationId`),
    CONSTRAINT `FK_PageOperation_PageHistory` FOREIGN KEY (`PageHistoryId`) REFERENCES `PageHistory`(`PageHistoryId`)
);
CREATE TABLE `EmbeddedFile` (
    `FileId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `PageId` INT NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Content` undefined NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_EmbeddedFile` PRIMARY KEY (`FileId`)
);
CREATE TABLE `Query` (
    `QueryId` INT NOT NULL AUTO_INCREMENT,
    `UserId` INT NOT NULL,
    `BookId` INT NULL,
    `IncludeBookName` BIT NOT NULL,
    `IncludeSectionName` BIT NOT NULL,
    `IncludePageName` BIT NOT NULL,
    `IncludePageContent` BIT NOT NULL,
    `UseRegularExpression` BIT NOT NULL,
    `Content` VARCHAR(null) NOT NULL,
    `CreateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    `UpdateTime` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
    CONSTRAINT `PK_Query` PRIMARY KEY (`QueryId`),
    CONSTRAINT `FK_Query_Book` FOREIGN KEY (`BookId`) REFERENCES `Book`(`BookId`)
);
