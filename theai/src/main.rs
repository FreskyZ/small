#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

// no, this is not the whole program's main entry
// the major entry is server/index.ts as server entry and client/index.tsx and main client page entry
// this is the entry for an alternative tool, this is currently investigating and may be formalized in future

// RESULT: the search by embedding similarity looks useful and is very interesting
// I'd like to add to the main application and conversation content is converted to embedding
// use a small model to make an abstraction and a title for the conversation, like the smallest qwen3 model qwen3-0.6b
// always embedding the title and abstraction (full message content is embded on demand)
// and use this to search for related topics
// into more technical details, the embedding data is stored with (message id + update time) considering I support full edit on any message,
// if message branch is embedded, I'd consider not allow this message to be deleted, don't forget delete message tree
// the embedding data, f32x1000, is simply a BINARY(4096) data column

// add a noembedding tag to indicate this session is not worthy embedding (like low quality) or should not be embedded (like template)
// add another title column to `dession` table to distinguish original title and my generated title?
// add another title to `Session` table to distinguish suggested title and user title?, add an column for conversation abstract?
// my conversations have branch, except normal full path embedding or shared path + distinct path embedding,
// ai is also suggesting turn by turn embedding, I'd like to try that

// UPDATE after you build vector database, create relationships between entities should be very useful
// the vector embeddings should show similar distance (vector subtract) with similar relationship
// e.g. king - man + woman about= queue, if you can collect a experienced relationship vector knowledge it should be more useful

use std::collections::HashMap;
use std::io::{Read, Seek, Write};
use std::fs;
use std::num::NonZero;
use anyhow::Result;
// use chrono::{DateTime, Utc};
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json;
use tokio;
use uuid::Uuid;
use futures::future::try_join_all;

#[derive(Deserialize)]
struct Config {
    #[serde(rename = "main-domain")]
    main_domain: String,
}
#[derive(Serialize)]
struct GetAuthorizationCodeBody {
    r#return: String,
}
#[derive(Deserialize)]
struct GetAuthorizationCodeResult {
    code: String,
}
#[derive(Deserialize)]
struct SignInResult {
    #[serde(rename = "accessToken")]
    access_token: String,
}

async fn get_app_access_token(client: &reqwest::Client, config: &Config) -> Result<String> {
    let id_access_token = std::env::var("FINE_ACCESSTOKEN")?;
    let authorization_code = client.post(format!("https://api.{}/generate-authorization-code", config.main_domain))
        .version(reqwest::Version::HTTP_2)
        .bearer_auth(id_access_token)
        .header(reqwest::header::ORIGIN, format!("https://id.{}", config.main_domain))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&GetAuthorizationCodeBody{ r#return: format!("https://chat.{}\"", config.main_domain) })
        .send().await?
        .error_for_status()?
        .json::<GetAuthorizationCodeResult>().await?.code;
    let app_access_token = client.post(format!("https://api.{}/signin", config.main_domain))
        .bearer_auth(authorization_code)
        .header(reqwest::header::ORIGIN, format!("https://chat.{}", config.main_domain))
        .send().await?
        .error_for_status()?
        .json::<SignInResult>().await?.access_token;
    println!("{}", app_access_token);
    Ok(app_access_token)
}

#[derive(Deserialize, Debug)]
struct Session {
    id: Uuid,
    seq_id: i32,
    title: String,
    // NOTE nodejs mysql package PoolOption.dateString is using YYYY-MM-DD hh:mm:ss date string,
    // which is not DateTime<Utc> default deserializable, to make things worse, it's using server's local timezone,
    // here use string for now
    inserted_at: String, // DateTime<Utc>,
    updated_at: String, // DateTime<Utc>,
}

async fn get_sessions(client: &reqwest::Client, config: &Config, access_token: &str) -> Result<Vec<Session>> {
    Ok(client.get(format!("https://api.{}/chat/v1/dsessions", config.main_domain))
        .version(reqwest::Version::HTTP_2)
        .bearer_auth(access_token)
        .header(reqwest::header::ORIGIN, format!("https://chat.{}", config.main_domain))
        .send().await?
        .error_for_status()?
        .json::<Vec<Session>>().await?)
}

#[derive(Deserialize, Debug)]
struct Message {
    message_id: i32,
    parent_id: Option<NonZero<i32>>,
    role: String,
    content: String,
    thinking_content: Option<String>,
    accumulated_token_usage: i32,
    inserted_at: String, // DateTime<Utc>,
}

async fn get_combined_messages(client: &reqwest::Client, config: &Config, access_token: &str, session_id: &Uuid, retry_index: usize) -> Result<String> {
    let response = client.get(format!("https://api.{}/chat/v1/dmessages", config.main_domain))
        .version(reqwest::Version::HTTP_2)
        .header(reqwest::header::ORIGIN, format!("https://chat.{}", config.main_domain))
        .query(&[("id", session_id)])
        .bearer_auth(access_token)
        .send().await?;
    if response.status().is_success() {
        println!("session {} downloaded messages", session_id);
        return Ok(response.json::<Vec<Message>>().await?
            .into_iter().map(|m| format!("{}: {}", if m.role == "USER" { "USER" } else { "AGENT" }, m.content))
            .collect::<Vec<String>>().join("\n"));
    } else if response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
        response.error_for_status()?;
        Ok(String::new())
    } else {
        // it was very interesting to see many requests blocked by 429 and rate limits gradually recover from very negative,
        // but to effectively complete the task, the promise.all is removed and change to a normal for each dealy
        let delay = (rand::random::<u64>() % 51 + 10) * retry_index as u64; // 10-60 seconds, and multiple retry index
        println!("session {} rate limited, retrying after delay {} seconds, {}th time", session_id, delay, retry_index);
        tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
        return Box::pin(get_combined_messages(client, config, access_token, session_id, retry_index + 1)).await;
    }
}

#[derive(Serialize)]
struct GetEmbeddingsBody<'a> {
    model: &'static str,
    input: &'a str,
}

async fn get_embeddings(client: &reqwest::Client, session_id: &Uuid, input: &str, api_key: &str) -> Result<Vec<f32>> {
    println!("session {} converting embeddings", session_id);

    let response = client.post("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings")
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&GetEmbeddingsBody{ model: "text-embedding-v4", input })
        .send().await?
        .text().await?;
    let response: serde_json::Value = serde_json::from_str(&response)?;
    Ok(response["data"][0]["embedding"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect())
}

async fn process_session(client: &reqwest::Client, config: &Config, access_token: &str, api_key: &str, session_id: Uuid) -> Result<Box<[u8]>> {

    let messages = get_combined_messages(client, config, access_token, &session_id, 1).await?;
    // println!("{}", messages);
    let embeddings = get_embeddings(&client, &session_id, &messages, &api_key).await?;
    // println!("{} {:?}", session_id, embeddings);

    assert_eq!(embeddings.len(), 1024);
    let buffer = Box::<[u8]>::new_uninit_slice(4112);
    // SAFETY: will initialize later, why is this so hard to use
    let mut buffer = unsafe { buffer.assume_init() };

    buffer[..16].copy_from_slice(session_id.as_bytes());
    let (ptr, len) = (embeddings.as_ptr(), embeddings.len());
    let ptr = ptr.cast::<u8>();
    // SAFETY:
    // ptr is not null, is aligned
    // is valid for read in len * 4 elements
    // is contained within a single allocated object
    // is not mutated in the slice's lifetime
    // is not too long
    let embeddings = unsafe { std::slice::from_raw_parts(ptr, len * 4) };
    buffer[16..].copy_from_slice(embeddings);

    Ok(buffer)
}

// // for now, single thread the network operations
// #[tokio::main(flavor = "current_thread")]
// async fn main() -> Result<()> {
//     let config_content = fs::read_to_string("akaric")?;
//     let config = serde_json::from_str::<Config>(&config_content)?;
//     let client = reqwest::Client::new();

//     let api_key = std::env::var("BAILIAN_APIKEY")?;
//     let app_access_token = get_app_access_token(&client, &config).await?; // std::env::var("FINECHAT_ACCESSTOKEN")?;

//     let mut file = fs::File::options().write(true).create(true).read(true).open("sessions.bin")?;
//     let mut existing_data = Vec::new();
//     file.read_to_end(&mut existing_data)?;
//     assert_eq!(existing_data.len() / 4112 * 4112, existing_data.len(), "length should be multiply of 4112");

//     let mut existing_session_ids = Vec::new();
//     for i in 0..existing_data.len() / 4112 {
//         let index = i * 4112;
//         let mut guid_bytes = [0u8; 16];
//         guid_bytes.copy_from_slice(&existing_data[index..index + 16]);
//         existing_session_ids.push(Uuid::from_bytes(guid_bytes));
//     }
//     println!("existing session count {}", existing_session_ids.len());

//     let mut buffers = Vec::new();
//     let sessions = get_sessions(&client, &config, &app_access_token).await?;
//     for session in sessions.into_iter().filter(|session| !existing_session_ids.iter().any(|e| e == &session.id)) {
//         buffers.push(process_session(&client, &config, &app_access_token, &api_key, session.id.clone()).await?);
//         tokio::time::sleep(std::time::Duration::from_secs(1)).await;
//     }

//     for buffer in buffers {
//         file.write(&buffer)?;
//     }
//     Ok(())
// }

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let client = reqwest::Client::new();
    let api_key = std::env::var("BAILIAN_APIKEY")?;

    // don't actually remove keyword.bin, temporary record them here
    // keyword1: 'http authentication'

    let keyword = if !fs::exists("keyword.bin")? {
        let embeddings = get_embeddings(&client, &Uuid::nil(), "大语言模型工作原理", &api_key).await?;
        println!("{:?}", embeddings);

        assert_eq!(embeddings.len(), 1024);
        let buffer = Box::<[u8]>::new_uninit_slice(4096);
        // SAFETY: will initialize later, why is this so hard to use
        let mut buffer = unsafe { buffer.assume_init() };

        let (ptr, len) = (embeddings.as_ptr(), embeddings.len());
        let ptr = ptr.cast::<u8>();
        // SAFETY:
        // ptr is not null, is aligned
        // is valid for read in len * 4 elements
        // is contained within a single allocated object
        // is not mutated in the slice's lifetime
        // is not too long
        let byte_embeddings = unsafe { std::slice::from_raw_parts(ptr, len * 4) };
        buffer.copy_from_slice(byte_embeddings);

        fs::write("keyword.bin", &buffer)?;
        embeddings
    } else {
        let mut buffer = Vec::with_capacity(4096);
        fs::File::open("keyword.bin")?.read_to_end(&mut buffer)?;
        let ptr = buffer.as_mut_ptr();
        // ? this is not unsafe?
        std::mem::forget(buffer);
        // SAFETY: TODO
        unsafe { Vec::from_raw_parts(ptr.cast::<f32>(), 1024, 1024) }
    };

    let mut similarities = Vec::new();
    let mut sessions_file = fs::File::open("sessions.bin")?;
    for i in 0..543 {
        sessions_file.seek(std::io::SeekFrom::Start(4112u64 * i))?;
        let mut session_and_embeddings_buffer = vec![0u8; 4112];
        sessions_file.read_exact(&mut session_and_embeddings_buffer)?;

        let session_id = Uuid::from_slice(&session_and_embeddings_buffer[..16])?;
        let ptr = session_and_embeddings_buffer[16..].as_ptr();
        // SAFETY: TODO
        let message = unsafe { std::slice::from_raw_parts(ptr.cast::<f32>(), 1024) };
        // println!("keyword: {keyword:?}, session id {session_id}, message {message:?}");

        // TODO try
        // #![feature(portable_simd)]
        // use std::simd::*;

        // // ...existing code...
        // let mut dot_sum = f32x8::splat(0.0);
        // let mut keyword_mag_sum = f32x8::splat(0.0);
        // let mut message_mag_sum = f32x8::splat(0.0);

        // for chunk in (0..1024).step_by(8) {
        //     let kw = f32x8::from_slice(&keyword[chunk..chunk + 8]);
        //     let msg = f32x8::from_slice(&message[chunk..chunk + 8]);
            
        //     dot_sum += kw * msg;
        //     keyword_mag_sum += kw * kw;
        //     message_mag_sum += msg * msg;
        // }

        // let dot_product: f32 = dot_sum.reduce_sum();
        // let keyword_magnitude: f32 = keyword_mag_sum.reduce_sum().sqrt();
        // let message_magnitude: f32 = message_mag_sum.reduce_sum().sqrt();
        
        let dot_product: f32 = (0..1024).map(|i| keyword[i] * message[i]).sum();
        let keyword_magnitude: f32 = (0..1024).map(|i| keyword[i] * keyword[i]).sum::<f32>().sqrt();
        let message_magnitude: f32 = (0..1024).map(|i| message[i] * message[i]).sum::<f32>().sqrt();
        let cosine_similarity = dot_product / (keyword_magnitude * message_magnitude);
        println!("session {session_id} similarity {cosine_similarity}");
        similarities.push((session_id, cosine_similarity));
    }
    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    for i in 0..10 {
        println!("{:?}", similarities[i]);
    }

    Ok(())
}
