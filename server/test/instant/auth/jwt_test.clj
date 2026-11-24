(ns instant.auth.jwt-test
  (:require
   [chime.core :as chime-core]
   [clojure.test :refer [deftest is testing]]
   [instant.auth.jwt :as jwt]
   [instant.config :as config]
   [instant.util.cache :as cache])
  (:import
   (java.lang AutoCloseable)
   (java.time Instant)
   (java.time.temporal ChronoUnit)))

(deftest start-prefetches-google-keys-only-when-configured
  (doseq [configured? [false true]]
    (testing (str "dashboard Google sign-in configured: " configured?)
      (let [fetched (atom [])]
        (with-redefs-fn {#'config/dashboard-google-oauth-configured? (constantly configured?)
                         #'jwt/refresh-cached-keys (fn [uri] (swap! fetched conj uri))}
          (fn []
            (try
              (jwt/start)
              (finally
                (jwt/stop)))))
        (is (= (if configured?
                 ["https://www.googleapis.com/oauth2/v3/certs"]
                 [])
               @fetched))))))

(deftest scheduled-refresh-refreshes-expiring-keys
  (let [scheduled (atom nil)
        refreshed (atom [])
        soon (.plus (Instant/now) 10 ChronoUnit/MINUTES)
        later (.plus (Instant/now) 5 ChronoUnit/HOURS)]
    (with-redefs-fn {#'config/dashboard-google-oauth-configured? (constantly false)
                     #'chime-core/chime-at (fn [_times f]
                                             (reset! scheduled f)
                                             (reify AutoCloseable
                                               (close [_])))
                     #'cache/as-map (constantly {"https://a.example/certs" {:expires soon}
                                                 "https://b.example/certs" {:expires soon}
                                                 "https://c.example/certs" {:expires later}})
                     #'jwt/refresh-cached-keys (fn [uri] (swap! refreshed conj uri))}
      (fn []
        (try
          (jwt/start)
          (@scheduled (Instant/now))
          (finally
            (jwt/stop)))))
    (is (= #{"https://a.example/certs" "https://b.example/certs"}
           (set @refreshed)))
    (is (= 2 (count @refreshed)))))
