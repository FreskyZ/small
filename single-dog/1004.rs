// PAT 1004 - https://www.patest.cn/contests/pat-a-practise/1004
// this url is not available for now, this solution is mainly developed at Sept 1, 2016

// A family hierarchy is usually presented by a pedigree tree. Your job is to
// count those family members who have no child.

// Input
// Each input file contains one test case. Each case starts with a line 
// containing `0 < N < 100`, the number of nodes in a tree, and `M (< N)`,
// the number of non-leaf nodes. Then `M` lines follow, each in the format:
//  `ID K ID[1] ID[2] ... ID[K]`
// where `ID` is a two-digit number representing a given non-leaf node, 
// `K` is the number of its children, followed by a sequence of two-digit 
// ID's of its children. For the sake of simplicity, 
// let us fix the root ID to be 01.

// Output
// For each test case, you are supposed to count those family members who 
// have no child for every seniority level starting from the root. The 
// numbers must be printed in a line, separated by a space, and there 
// must be no extra space at the end of each line. The sample case 
// represents a tree with only 2 nodes, where 01 is the root and 02 is its 
// only child. Hence on the root 01 level, there is 0 leaf node; and on the 
// next level, there is 1 leaf node. Then we should output "0 1" in a line.

// Sample Input
// 2 1
// 01 1 02
// Sample Output
// 0 1

#![allow(dead_code)]

use std::fmt;
use std::ops::Index;

#[derive(Clone)]
struct TreeNode {
    id: i32,
    children: Vec<TreeNode>,
}

impl TreeNode {
    fn new(id: i32) -> TreeNode {
        TreeNode { id: id, children: Vec::new() }
    }

    fn new_by(id:i32, child: Vec<TreeNode>) -> TreeNode {
        TreeNode { id: id, children: child }
    }

    fn is_single(&self) -> bool {
        self.children.is_empty()
    }

    fn len(&self) -> usize {
        self.children.len()
    }
}

impl fmt::Display for TreeNode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.id).and(
            match self.is_single() {
                true => Ok(()),
                false => {
                    let mut result = write!(f, "(");
                    for i in 0..(self.children.len() - 1) {
                        result = result
                            .and(Self::fmt(&self.children[i], f))
                            .and(write!(f, ", "));
                    }
                    result
                        .and(Self::fmt(&self.children[self.children.len() - 1], f))
                        .and(write!(f, ")"))
                }
            }
        )
    }
}

impl Index<usize> for TreeNode {
    type Output = TreeNode;
    fn index(&self, index: usize) -> &Self::Output {
        &self.children[index]
    }
} 

fn count_single_dog(ancestor: &TreeNode) -> Vec<i32> {

    println!("Input: {}", ancestor);
    let mut current_line : Vec<TreeNode> = vec![ancestor.clone()];
    let mut next_line : Vec<TreeNode> = Vec::new();

    let mut current_level = 0_usize;
    let mut ret_val = Vec::new();

    while !current_line.is_empty() {
        for element in &current_line {
            if element.is_single() {
                if ret_val.len() <= current_level {
                    for _ in ret_val.len()..current_level {
                        ret_val.push(0);
                    }
                    ret_val.push(1);
                } else {
                    ret_val[current_level] += 1;
                }
            } else {
                next_line.append(&mut element.children.clone());
            }
        }

        current_level += 1;
        current_line = next_line;
        next_line = Vec::new();
    }

    println!("Result is {:?}", ret_val);
    ret_val
}

fn main() {
    
    let ancestor = TreeNode::new_by(1, vec![
        TreeNode::new_by(2, vec![
            TreeNode::new_by(5, vec![
                TreeNode::new_by(8, vec![
                    TreeNode::new(16)
                ]),
                TreeNode::new_by(9, vec![
                    TreeNode::new(17)
                ]),
                TreeNode::new(10),
                TreeNode::new_by(11, vec![
                    TreeNode::new(18)
                ]),
            ]),
            TreeNode::new_by(6, vec![
                TreeNode::new_by(12, vec![
                    TreeNode::new(19)
                ])
            ])
        ]),
        TreeNode::new(3), 
        TreeNode::new_by(4, vec![
            TreeNode::new_by(7, vec![
                TreeNode::new(13),
                TreeNode::new_by(14, vec![
                    TreeNode::new(20)
                ]),
                TreeNode::new_by(15, vec![
                    TreeNode::new(21)
                ])
            ])
        ])
    ]);
    assert_eq!(count_single_dog(&ancestor), [0, 1, 0, 2, 6]);

    let ancestor = TreeNode::new(1);
    assert_eq!(count_single_dog(&ancestor), [1]);

    println!("Success");
}
