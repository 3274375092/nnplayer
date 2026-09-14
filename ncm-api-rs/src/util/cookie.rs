/// Cookie 工具函数
use std::collections::HashMap;

/// 将 cookie 字符串解析为 HashMap
pub fn cookie_to_json(cookie: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if cookie.is_empty() {
        return map;
    }
    for item in cookie.split(';') {
        let parts: Vec<&str> = item.splitn(2, '=').collect();
        if parts.len() == 2 {
            // cookie_obj_to_string 会做百分号编码，这里必须解码才可往返一致；
            // 解码失败（含裸 '%' 等）时退回原文，避免破坏原始 cookie。
            let key = urlencoding::decode(parts[0].trim())
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| parts[0].trim().to_string());
            let value = urlencoding::decode(parts[1].trim())
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| parts[1].trim().to_string());
            map.insert(key, value);
        }
    }
    map
}

/// 将 HashMap 转换为 cookie 字符串
pub fn cookie_obj_to_string(cookie: &HashMap<String, String>) -> String {
    cookie
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("; ")
}

/// 从 cookie map 中获取指定 key 的值
pub fn get_cookie_value(cookie: &HashMap<String, String>, key: &str) -> Option<String> {
    cookie.get(key).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cookie_to_json() {
        let cookie = "name=value; foo=bar; empty=";
        let map = cookie_to_json(cookie);
        assert_eq!(map.get("name").unwrap(), "value");
        assert_eq!(map.get("foo").unwrap(), "bar");
        assert_eq!(map.get("empty").unwrap(), "");
    }

    #[test]
    fn test_cookie_to_json_empty() {
        let map = cookie_to_json("");
        assert!(map.is_empty());
    }

    #[test]
    fn test_cookie_obj_to_string() {
        let mut map = HashMap::new();
        map.insert("name".to_string(), "value".to_string());
        let s = cookie_obj_to_string(&map);
        assert!(s.contains("name=value"));
    }

    #[test]
    fn test_cookie_roundtrip_preserves_special_characters() {
        let mut map = HashMap::new();
        map.insert("key with space".to_string(), "a=b; c".to_string());
        let serialized = cookie_obj_to_string(&map);
        let parsed = cookie_to_json(&serialized);
        assert_eq!(parsed.get("key with space").unwrap(), "a=b; c");
    }

    #[test]
    fn test_cookie_to_json_keeps_raw_percent() {
        let map = cookie_to_json("broken=%zz");
        assert_eq!(map.get("broken").unwrap(), "%zz");
    }
}
