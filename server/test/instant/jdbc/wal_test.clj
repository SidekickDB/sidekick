(ns instant.jdbc.wal-test
  (:require
   [clojure.string]
   [clojure.test :refer [deftest is]]
   [instant.config :as config]
   [instant.flags :as flags]
   [instant.jdbc.sql :as sql]
   [instant.jdbc.wal :as wal]
   [next.jdbc.connection]))

(defn- replication-conn-logical-decoding-work-mem []
  (with-open [conn (#'wal/get-pg-replication-conn (config/get-aurora-config))]
    (:logical_decoding_work_mem
     (sql/select-one ::show conn ["show logical_decoding_work_mem"]))))

(deftest replication-conn-sets-logical-decoding-work-mem
  (is (= "64MB" (replication-conn-logical-decoding-work-mem)))
  (binding [flags/*flag-overrides* {:logical-decoding-work-mem-kb (* 32 1024)}]
    (is (= "32MB" (replication-conn-logical-decoding-work-mem)))))

(deftest split-url-options-pulls-options-out-of-the-url
  (is (= ["jdbc:postgresql://db:5432/app" nil]
         (wal/split-url-options "jdbc:postgresql://db:5432/app")))
  (is (= ["jdbc:postgresql://db:5432/app?user=u&ApplicationName=x" nil]
         (wal/split-url-options "jdbc:postgresql://db:5432/app?user=u&ApplicationName=x")))
  (is (= ["jdbc:postgresql://db:5432/app?user=u&sslmode=require"
          "-c statement_timeout=5000 -c search_path=a,b"]
         (wal/split-url-options
          (str "jdbc:postgresql://db:5432/app?user=u&options="
               "-c%20statement_timeout%3D5000+-c%20search_path%3Da%2Cb"
               "&sslmode=require"))))
  (is (= ["jdbc:postgresql://db:5432/app" "-c a=1 -c b=2"]
         (wal/split-url-options
          "jdbc:postgresql://db:5432/app?options=-c%20a%3D1&options=-c%20b%3D2"))))

(defn- show-on-replication-conn [db-spec setting]
  (with-open [conn (#'wal/get-pg-replication-conn db-spec)]
    (get (sql/select-one ::show conn [(str "show " setting)])
         (keyword setting))))

(deftest replication-conn-keeps-url-options-and-still-bounds-memory
  ;; pgjdbc lets `options` in the URL override the OPTIONS property, which
  ;; would drop logical_decoding_work_mem if DATABASE_URL carried options.
  (let [url (next.jdbc.connection/jdbc-url (config/get-aurora-config))
        url-options (java.net.URLEncoder/encode
                     "-c statement_timeout=12345 -c logical_decoding_work_mem=128MB"
                     "UTF-8")
        db-spec {:jdbcUrl (str url
                               (if (clojure.string/includes? url "?") "&" "?")
                               "options=" url-options)}]
    (is (= "12345ms" (show-on-replication-conn db-spec "statement_timeout")))
    (is (= "64MB" (show-on-replication-conn db-spec "logical_decoding_work_mem")))))
