(ns instant.core-test
  (:require
   [clojure.string :as string]
   [clojure.test :refer [deftest is testing]]
   [instant.core :as core]))

(defn- csp [resp]
  (get-in (core/add-security-headers resp) [:headers "Content-Security-Policy"]))

(deftest add-security-headers-csp
  (testing "denies by default and keeps script-src self"
    (let [policy (csp {:headers {}})]
      (is (string/includes? policy "default-src 'none'"))
      (is (string/includes? policy "script-src 'self'"))
      (is (string/includes? policy "object-src 'none'"))
      (is (string/includes? policy "base-uri 'self'"))
      (is (string/includes? policy "frame-ancestors 'none'"))))

  (testing "hashes inline scripts in script-src"
    (let [policy (csp {:headers {} :inline-scripts ["alert(1)"]})]
      (is (re-find #"script-src 'self' 'sha256-[A-Za-z0-9+/=]+'" policy))
      (is (string/includes? policy "default-src 'none'")))))

(defn- directive [policy directive-name]
  (some (fn [d]
          (let [d (string/trim d)]
            (when (or (= d directive-name)
                      (string/starts-with? d (str directive-name " ")))
              d)))
        (string/split policy #";")))

(deftest add-security-headers-csp-exact-directives
  (testing "script-src carries the exact digest of each inline script and never 'unsafe-inline'"
    (let [policy (csp {:headers {} :inline-scripts ["alert(1)"]})]
      ;; printf 'alert(1)' | openssl dgst -sha256 -binary | base64
      (is (= "script-src 'self' 'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"
             (directive policy "script-src")))
      (is (not (string/includes? (directive policy "script-src") "unsafe-inline")))))

  (testing "script-src is only 'self' without inline scripts"
    (is (= "script-src 'self'" (directive (csp {:headers {}}) "script-src"))))

  (testing "inline <style> blocks on the OAuth landing pages stay allowed"
    (is (= "style-src 'unsafe-inline'" (directive (csp {:headers {}}) "style-src")))))
