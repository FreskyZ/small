import { Config as ClientConfig } from '@alicloud/openapi-client';
import Credential, { Config as CredentialConfig } from '@alicloud/credentials';
import Alidns, * as RequestTypes from '@alicloud/alidns20150109';

// the official demo code
// https://next.api.aliyun.com/api-tools/sdk/Alidns?version=2015-01-09&language=typescript-tea&tab=primer-doc
// is very java and very not typescript and nodejs

// despite removing the meaningless class static method and class static main, and forced to use very many new,
// ATTENTION that the default export of the /credentials package, need yet another .default to get the actual class
const credential = new Credential.default(new CredentialConfig({
    // tmd, no type for these properties, but should be same as class's properties
    type: 'access_key',
    accessKeyId: process.env.ALIDNS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIDNS_ACCESS_KEY_SECRET,
}));
// to make things worse, the .default operation makes the response lose its type
const client = new Alidns.default(new ClientConfig({
    // tmd, no type for these properties, but should be same as class's properties
    credential,
    endpoint: 'alidns.cn-shanghai.aliyuncs.com',
}));

// const response = await client.describeDomainRecords(new DescribeDomainRecordsRequest({
//     // tmd, even no type here
//     domainName: 'example.com',
// }));
// console.log(response.body.domainRecords.record);

const response = await client.addDomainRecord(new RequestTypes.AddDomainRecordRequest({
    domainName: 'example.com',
    RR: '_acme-challenge',
    type: 'TXT',
    value: 'somerandomhashvalue2',
}));
console.log(response.body.recordId);

// const response = await client.deleteDomainRecord(new RequestTypes.DeleteDomainRecordRequest({
//     recordId: '0', // NOTE this is string, because it seems larger than max safe int
// }));
// console.log(response.body.recordId);