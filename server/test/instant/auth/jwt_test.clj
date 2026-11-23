(ns instant.auth.jwt-test
  (:require
   [clojure.test :refer [deftest is testing]]
   [instant.auth.jwt :as jwt]
   [instant.config :as config]))

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
