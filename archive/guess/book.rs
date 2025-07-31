// https://doc.rust-lang.org/book/guessing-game.html
//
// this script is imported from another repository, which is mainly devloped in Sept 1, 2016

extern crate rand;

use std::io::stdin;
use std::cmp::Ordering;
use rand::Rng;

fn main() {
    println!("Guess a number");
    println!("Input a number: ");

    let target_num = rand::thread_rng().gen_range::<i32>(1, 101);

    loop {
        let mut number = String::new();
        match stdin().read_line(&mut number) {
            Err(e) => println!("Read line get error: {}", e),
            _ => { },
        }
        
        match number.trim().parse::<i32>() {
            Err(_) => { println!("Please input a number: "); continue; }
            Ok(-1) => { println!("Aborting..."); return; }
            Ok(number) => match number.cmp(&target_num) {
                Ordering::Less => println!("Too small"),
                Ordering::Greater => println!("Too big"),
                Ordering::Equal => { println!("Success"); return (); },
            }
        }
    }
}
