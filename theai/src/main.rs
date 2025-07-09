#![allow(dead_code)]

// no, this is not the whole program's main entry
// the major entry is server/index.ts as server entry and client/index.tsx and main client page entry
// this is the entry for an alternative tool, this is currently investigating and may be formalized in future

use std::fs;
use std::num::NonZero;
use anyhow::Result;
// use chrono::{DateTime, Utc};
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json;
use tokio;
use uuid::Uuid;

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

async fn get_app_access_token(client: &reqwest::Client, config: &Config, id_access_token: &str) -> Result<String> {

    let authorization_code = client.post(format!("https://api.{}/generate-authorization-code", config.main_domain))
        .version(reqwest::Version::HTTP_2)
        .bearer_auth(id_access_token)
        .header(reqwest::header::ORIGIN, format!("https://id.{}", config.main_domain))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&GetAuthorizationCodeBody{ r#return: format!("https://chat.{}\"", config.main_domain) })
        .send().await?
        .error_for_status()?
        .json::<GetAuthorizationCodeResult>().await?.code;
    Ok(client.post(format!("https://api.{}/signin", config.main_domain))
        .bearer_auth(authorization_code)
        .header(reqwest::header::ORIGIN, format!("https://chat.{}", config.main_domain))
        .send().await?
        .json::<SignInResult>().await?.access_token)
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

async fn get_combined_messages(client: &reqwest::Client, config: &Config, access_token: &str, session_id: &Uuid) -> Result<String> {
    println!("session {} downloading messages", session_id);
    Ok(client.get(format!("https://api.{}/chat/v1/dmessages", config.main_domain))
        .version(reqwest::Version::HTTP_2)
        .header(reqwest::header::ORIGIN, format!("https://chat.{}", config.main_domain))
        .query(&[("id", session_id)])
        .bearer_auth(access_token)
        .send().await?
        .error_for_status()?
        .json::<Vec<Message>>().await?
        .into_iter().map(|m| format!("{}: {}", if m.role == "USER" { "USER" } else { "AGENT" }, m.content))
        .collect::<Vec<String>>().join("\n"))
}

#[derive(Serialize)]
struct GetEmbeddingsBody<'a> {
    model: &'static str,
    input: &'a str,
}

async fn get_embeddings(client: &reqwest::Client, session_id: &Uuid, input: &str, api_key: &str) -> Result<Vec<f64>> {
    println!("session {} converting embeddings", session_id);

    let response = client.post("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings")
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&GetEmbeddingsBody{ model: "text-embedding-v4", input })
        .send().await?
        .text().await?;
    let response: serde_json::Value = serde_json::from_str(&response)?;
    Ok(response["data"][0]["embedding"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect())
}

#[tokio::main]
async fn main() -> Result<()> {
    let config_content = fs::read_to_string("akaric")?;
    let config = serde_json::from_str::<Config>(&config_content)?;

    let api_key = std::env::var("BAILIAN_APIKEY")?;
    // let id_access_token = std::env::var("FINE_ACCESSTOKEN")?;
    let app_access_token = std::env::var("FINECHAT_ACCESSTOKEN")?;

    let client = reqwest::Client::new();
    // println!("{}", get_app_access_token(&client, &config, &id_access_token).await?);
    let sessions = get_sessions(&client, &config, &app_access_token).await?;
    // println!("{:?}", sessions);
    let messages = get_combined_messages(&client, &config, &app_access_token, &sessions[0].id).await?;
    // println!("{}", messages);
    let embeddings = get_embeddings(&client, &sessions[0].id, &messages, &api_key).await?;
    println!("{:?}", embeddings);

    Ok(())
}
