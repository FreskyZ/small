
import dayjs from 'dayjs';
import mysql from 'mysql2/promise';

// query function need RowDataPacket, but this makes 
// the original type cannot be construct if use UserData extends RowDataPacket (missing required property),
// so use this helper generic type alias
export type QueryResult<T> = T & mysql.RowDataPacket;
// result of insert/update/delete, which is data Manipulatation language Result
export type ManipulateResult = mysql.ResultSetHeader;

export const databaseTypeCast: mysql.TypeCast = (field, next) =>
    field.type == 'BIT' && field.length == 1 ? field.buffer()[0] == 1
    // NOTE this make DATETIME column directly dayjs.Dayjs in query result,
    // don't forget database type property type if you are developing app without codegen
    : field.type == 'DATETIME' ? dayjs.utc(field.string(), 'YYYY-MM-DD hh:mm:ss')
    : next();

export function formatDatabaseDate(value: dayjs.Dayjs) {
    return value.format('YYYY-MM-DD');
}
export function formatDatabaseDateTime(value: dayjs.Dayjs) {
    return value.format('YYYY-MM-DD HH:mm:ss');
}

// avoid millisecond part in Dayjs.toISOString()
// // this is not database directly related function but
// // but already 2 dayjs format function so put this here by the way
export function toISOString(value: dayjs.Dayjs) {
    return value.format('YYYY-MM-DDTHH:mm:ss[Z]');
}
