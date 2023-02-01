
// This project is imported from another repository, it was mainly developed(?) in Nov 2016
//
// the following comment is not relavent to the following comment, I'm really not afraid of writing unsafe at that time (now still),
// the following comment is motivated by the hate to some really bad softwares run on my computer at that time,
// now they have gone away from my computer for many years, but this code live until now and is now archived to my github.
// the following code is a demostration of how you should be responsible to your unsafe statement

// Some process util
// currently core feature is "keep dead", work like `taskkill` in infinite loop
// core implementation is in fsz-common

fn main() {
    println!("Hello, world!");

    let mut stack = [0u8; 5];

    unsafe { 
        *(&mut stack[0] as *mut u8 as *mut u64) = 0x123456789ABCDEF0;  
    }

    println!("{:?}", stack);
    println!("{}", dummy);
}
