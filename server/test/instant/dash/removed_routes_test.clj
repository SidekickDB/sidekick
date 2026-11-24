(ns instant.dash.removed-routes-test
  "Routes SidekickDB removed from upstream's server stay removed."
  (:require
   [clojure.java.io :as io]
   [clojure.string :as string]
   [clojure.test :refer [deftest is testing]]
   [instant.dash.routes :as dash-routes])
  (:import
   (java.security MessageDigest)))

(defn- sha256 [^String s]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256")
                        (.getBytes s "UTF-8"))]
    (string/join (map #(format "%02x" (bit-and % 0xff)) digest))))

;; SHA-256 of the access key the removed session-count WebSocket accepted.
;; Only the hash is kept here, so the key itself does not reappear.
(def removed-key-sha256
  "c2637dc705fe0bd0c1bce8d3dc42d4be8901943b541a39aadfa70d4011af008d")

(deftest session-counts-route-is-gone
  (testing "GET /dash/session_counts matches no route"
    (is (nil? (dash-routes/routes {:request-method :get
                                   :uri "/dash/session_counts"
                                   :headers {}}))))
  (testing "the session counter namespace is not on the classpath"
    (is (nil? (io/resource "instant/session_counter.clj")))))

(deftest ws-playground-route-is-gone
  (testing "GET /dash/ws_playground matches no route"
    (is (nil? (dash-routes/routes {:request-method :get
                                   :uri "/dash/ws_playground"
                                   :headers {}})))))

(deftest no-source-holds-the-removed-key
  (let [uuid-re #"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
        files (->> (file-seq (io/file "src"))
                   (filter #(re-find #"\.(clj|cljc|java)$" (.getName ^java.io.File %))))]
    (is (seq files) "found no server sources; run from the server directory")
    (doseq [^java.io.File f files
            uuid (distinct (re-seq uuid-re (slurp f)))]
      (is (not= removed-key-sha256 (sha256 uuid))
          (str (.getPath f) " contains the removed access key")))))
