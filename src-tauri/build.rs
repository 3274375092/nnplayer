fn main() {
    tauri_build::build()
}

pub fn merge(intervals: Vec<Vec<i32>>) -> Vec<Vec<i32>> {
    let mut v1 = vec![];
    v1 = intervals[0];
    let len = intervals.len();
    let mut out = vec![v1];
    for i in 1..len {
        if v1[1] >= intervals[i][0] {
            v1[0] = v1[0].min(intervals[i][0]);
            v1[1] = v1[1].max(intervals[i][1]);
        } else {
            out.push(v1);
            v1 = intervals[i];
        }
        out[out.len() - 1] = v1;
    }
    out
}
