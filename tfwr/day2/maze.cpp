// deepseek and claude solution for reference

// deepseek
#include <vector>
#include <queue>
#include <utility>
#include <cstring>

using namespace std;

// External function provided - returns false if movement is blocked by wall
bool try_move(int direction);

// Directions: 0=up, 1=right, 2=down, 3=left
const int dx[4] = {0, 1, 0, -1};
const int dy[4] = {-1, 0, 1, 0};

// Global variables to track maze state
vector<vector<bool>> visited;
vector<vector<bool>> wall_up;    // Wall above cell (i,j)
vector<vector<bool>> wall_right; // Wall to right of cell (i,j)
vector<vector<bool>> wall_down;  // Wall below cell (i,j)  
vector<vector<bool>> wall_left;  // Wall to left of cell (i,j)

bool is_valid(int x, int y, int n) {
    return x >= 0 && x < n && y >= 0 && y < n;
}

bool move_to(int from_x, int from_y, int to_x, int to_y, int n) {
    if (!is_valid(to_x, to_y, n)) return false;
    
    // Determine direction
    int dir;
    if (to_x == from_x + 1 && to_y == from_y) dir = 1; // right
    else if (to_x == from_x - 1 && to_y == from_y) dir = 3; // left
    else if (to_x == from_x && to_y == from_y + 1) dir = 2; // down
    else if (to_x == from_x && to_y == from_y - 1) dir = 0; // up
    else return false; // Not adjacent
    
    // Check if we already know there's a wall
    if (dir == 0 && wall_up[from_y][from_x]) return false;
    if (dir == 1 && wall_right[from_y][from_x]) return false;
    if (dir == 2 && wall_down[from_y][from_x]) return false;
    if (dir == 3 && wall_left[from_y][from_x]) return false;
    
    // Try to move
    if (try_move(dir)) {
        return true;
    } else {
        // Record the wall
        if (dir == 0) wall_up[from_y][from_x] = true;
        if (dir == 1) wall_right[from_y][from_x] = true;
        if (dir == 2) wall_down[from_y][from_x] = true;
        if (dir == 3) wall_left[from_y][from_x] = true;
        return false;
    }
}

void dfs(int x, int y, int tx, int ty, int n, bool& found) {
    if (found) return;
    
    visited[y][x] = true;
    
    // Check if we found the treasure
    if (x == tx && y == ty) {
        found = true;
        return;
    }
    
    // Try all four directions
    for (int dir = 0; dir < 4; dir++) {
        int nx = x + dx[dir];
        int ny = y + dy[dir];
        
        if (is_valid(nx, ny, n) && !visited[ny][nx]) {
            if (move_to(x, y, nx, ny, n)) {
                dfs(nx, ny, tx, ty, n, found);
                if (found) return;
                // Move back
                move_to(nx, ny, x, y, n);
            }
        }
    }
}

void solve(int n, int tx, int ty) {
    // Initialize data structures
    visited = vector<vector<bool>>(n, vector<bool>(n, false));
    wall_up = vector<vector<bool>>(n, vector<bool>(n, false));
    wall_right = vector<vector<bool>>(n, vector<bool>(n, false));
    wall_down = vector<vector<bool>>(n, vector<bool>(n, false));
    wall_left = vector<vector<bool>>(n, vector<bool>(n, false));
    
    bool found = false;
    dfs(0, 0, tx, ty, n, found);
}

// deepseek #2
#include <vector>
#include <queue>
#include <utility>

using namespace std;

bool try_move(int direction);

const int dx[4] = {0, 1, 0, -1};
const int dy[4] = {-1, 0, 1, 0};

void solve(int n, int tx, int ty) {
    vector<vector<bool>> visited(n, vector<bool>(n, false));
    vector<vector<bool>> wall_up(n, vector<bool>(n, false));
    vector<vector<bool>> wall_right(n, vector<bool>(n, false));
    vector<vector<bool>> wall_down(n, vector<bool>(n, false));
    vector<vector<bool>> wall_left(n, vector<bool>(n, false));
    
    queue<pair<int, int>> q;
    q.push({0, 0});
    visited[0][0] = true;
    
    while (!q.empty()) {
        auto [x, y] = q.front();
        q.pop();
        
        if (x == tx && y == ty) {
            return; // Found treasure
        }
        
        for (int dir = 0; dir < 4; dir++) {
            int nx = x + dx[dir];
            int ny = y + dy[dir];
            
            if (nx >= 0 && nx < n && ny >= 0 && ny < n && !visited[ny][nx]) {
                // Check if we already know there's a wall
                bool known_wall = false;
                if (dir == 0 && wall_up[y][x]) known_wall = true;
                if (dir == 1 && wall_right[y][x]) known_wall = true;
                if (dir == 2 && wall_down[y][x]) known_wall = true;
                if (dir == 3 && wall_left[y][x]) known_wall = true;
                
                if (!known_wall && try_move(dir)) {
                    visited[ny][nx] = true;
                    q.push({nx, ny});
                } else if (!known_wall) {
                    // Record the wall
                    if (dir == 0) wall_up[y][x] = true;
                    if (dir == 1) wall_right[y][x] = true;
                    if (dir == 2) wall_down[y][x] = true;
                    if (dir == 3) wall_left[y][x] = true;
                }
            }
        }
    }
}

// claude
#include <iostream>
#include <vector>
#include <queue>
#include <unordered_set>
#include <string>

// External function provided
extern bool try_move(int direction);

// Direction constants
const int UP = 0;
const int RIGHT = 1;
const int DOWN = 2;
const int LEFT = 3;

// Opposite directions for backtracking
const int opposite_direction[4] = {DOWN, LEFT, UP, RIGHT};

// Direction vectors for (dx, dy) movement
const int dx[4] = {-1, 0, 1, 0}; // UP, RIGHT, DOWN, LEFT
const int dy[4] = {0, 1, 0, -1}; // UP, RIGHT, DOWN, LEFT

// Class to represent position
struct Position {
    int x, y;
    
    Position(int _x, int _y) : x(_x), y(_y) {}
    
    bool operator==(const Position& other) const {
        return x == other.x && y == other.y;
    }
    
    std::string to_string() const {
        return std::to_string(x) + "," + std::to_string(y);
    }
};

// Hash function for Position to use in unordered_set
namespace std {
    template<>
    struct hash<Position> {
        size_t operator()(const Position& p) const {
            return hash<string>{}(p.to_string());
        }
    };
}

// Structure to represent a wall between two positions
struct Wall {
    Position p1, p2;
    
    Wall(Position _p1, Position _p2) : p1(_p1), p2(_p2) {
        // Ensure consistent ordering for wall representation
        if (p2.to_string() < p1.to_string()) {
            std::swap(p1, p2);
        }
    }
    
    bool operator==(const Wall& other) const {
        return (p1 == other.p1 && p2 == other.p2);
    }
    
    std::string to_string() const {
        return p1.to_string() + "-" + p2.to_string();
    }
};

// Hash function for Wall to use in unordered_set
namespace std {
    template<>
    struct hash<Wall> {
        size_t operator()(const Wall& w) const {
            return hash<string>{}(w.to_string());
        }
    };
}

// Maze solver implementation
void solve(int n, int tx, int ty) {
    Position current(0, 0);
    Position target(tx, ty);
    
    std::unordered_set<Position> visited;
    std::unordered_set<Wall> walls;
    
    // Function to check if a position is valid (within maze bounds)
    auto is_valid = [n](const Position& p) -> bool {
        return p.x >= 0 && p.x < n && p.y >= 0 && p.y < n;
    };
    
    // Function to perform DFS search
    std::function<bool(Position&)> dfs = [&](Position& pos) -> bool {
        // Mark current position as visited
        visited.insert(pos);
        
        // Check if we've reached the target
        if (pos == target) {
            return true;
        }
        
        // Try all four directions
        for (int dir = 0; dir < 4; dir++) {
            // Calculate new position
            Position next_pos(pos.x + dx[dir], pos.y + dy[dir]);
            
            // Skip if new position is out of bounds
            if (!is_valid(next_pos)) {
                continue;
            }
            
            // Skip if we've already tried this wall and know it exists
            Wall potential_wall(pos, next_pos);
            if (walls.find(potential_wall) != walls.end()) {
                continue;
            }
            
            // Try to move in the direction
            if (try_move(dir)) {
                // Move successful, we're now at next_pos
                current = next_pos;
                
                // If we haven't visited this position or if we need to re-explore it
                if (visited.find(next_pos) == visited.end()) {
                    if (dfs(current)) {
                        return true; // We found the target
                    }
                }
                
                // Backtrack to the original position
                bool backtrack_success = try_move(opposite_direction[dir]);
                if (!backtrack_success) {
                    std::cerr << "ERROR: Failed to backtrack!" << std::endl;
                }
                current = pos; // Update current position after backtracking
            } else {
                // Move failed, there's a wall
                walls.insert(potential_wall);
            }
        }
        
        return false; // Target not found from this path
    };
    
    // Start the DFS from the initial position (0, 0)
    if (dfs(current)) {
        std::cout << "Maze solved! Treasure found at (" << tx << ", " << ty << ")" << std::endl;
    } else {
        std::cout << "No solution exists!" << std::endl;
    }
}
